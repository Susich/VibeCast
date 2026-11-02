package com.vibecast.app.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.database.ContentObserver
import android.net.ConnectivityManager
import android.net.Network
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.provider.MediaStore
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.vibecast.app.BuildConfig
import com.vibecast.app.MainActivity
import com.vibecast.app.R
import com.vibecast.app.data.CatalogRepository
import com.vibecast.app.data.CoverStore
import com.vibecast.app.data.MediaStoreScanner
import com.vibecast.app.data.TokenStore
import com.vibecast.app.server.AndroidDataSource
import com.vibecast.shared.server.ServerConfig
import com.vibecast.shared.server.SseHub
import com.vibecast.shared.server.vibeCastModule
import io.ktor.server.cio.CIO
import io.ktor.server.engine.EmbeddedServer
import io.ktor.server.engine.embeddedServer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket

/**
 * Foreground service: сканирует медиатеку, держит Ktor-сервер, публикует mDNS и
 * переживает выключение экрана. Сервер не логирует токен.
 */
class ServerService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private lateinit var tokenStore: TokenStore
    private var repository: CatalogRepository? = null
    private var sseHub: SseHub? = null
    private var server: EmbeddedServer<*, *>? = null
    private var nsdPublisher: NsdPublisher? = null
    private var contentObserver: ContentObserver? = null
    private var versionJob: Job? = null
    private var rescanJob: Job? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null
    private var multicastLock: WifiManager.MulticastLock? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private var mdnsJob: Job? = null
    private var mdnsPort: Int? = null
    private var udpBeaconJob: Job? = null
    private var started = false
    private var stopped = false

    override fun onCreate() {
        super.onCreate()
        tokenStore = TokenStore(applicationContext)
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                shutdown()
                stopSelf()
                return START_NOT_STICKY
            }

            ACTION_RESCAN -> {
                if (!started) startAll() else scheduleRescan(delayMs = 0)
                return START_STICKY
            }

            else -> startAll()
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        shutdown()
        scope.cancel()
        super.onDestroy()
    }

    private fun startAll() {
        if (started) {
            val state = ServerRuntime.current()
            if (!state.running && !state.starting && !state.scanning) {
                scope.launch { bootstrap() }
            }
            return
        }
        started = true
        try {
            startForegroundNow()
        } catch (t: Throwable) {
            Log.e(TAG, "Не удалось перейти в foreground: ${t.javaClass.simpleName}")
            started = false
            ServerRuntime.update {
                it.copy(error = "Android не разрешил фоновую работу. Откройте приложение и повторите.")
            }
            stopSelf()
            return
        }

        acquireLocks()
        startNetworkMonitor()
        val token = tokenStore.token()
        ServerRuntime.update {
            it.copy(
                starting = true,
                token = token,
                deviceName = deviceLabel(),
                error = null,
                warning = null,
            )
        }
        updateNotification()
        scope.launch { bootstrap() }
    }

    private suspend fun bootstrap() {
        try {
            val repo = CatalogRepository(tokenStore, MediaStoreScanner(applicationContext))
            repository = repo
            ServerRuntime.update { it.copy(starting = true, scanning = true, error = null) }
            updateNotification()

            val outcome = repo.rescan()
            val hub = SseHub()
            hub.publish(outcome.version)
            sseHub = hub

            versionJob?.cancel()
            versionJob = scope.launch {
                repo.versionFlow.drop(1).collect { version ->
                    hub.publish(version)
                    ServerRuntime.update {
                        it.copy(version = version, trackCount = repo.trackCount)
                    }
                    updateNotification()
                }
            }

            val port = findAvailablePort(TokenStore.DEFAULT_PORT)
            val covers = CoverStore(applicationContext, repo)
            ServerRuntime.repository = repo
            ServerRuntime.coverStore = covers
            val dataSource = AndroidDataSource(
                context = applicationContext,
                repository = repo,
                covers = covers,
            )
            val engine = embeddedServer(CIO, port = port, host = "0.0.0.0") {
                vibeCastModule(
                    data = dataSource,
                    config = ServerConfig(
                        token = tokenStore.token(),
                        appVersion = BuildConfig.VERSION_NAME,
                    ),
                    hub = hub,
                    remoteHub = ServerRuntime.remoteHub,
                )
            }
            engine.start(wait = false)
            server = engine

            val ip = localIpAddress()
            mdnsPort = port
            publishMdns(port)
            startUdpBroadcast(port)
            registerMediaObserver()

            ServerRuntime.update {
                it.copy(
                    running = true,
                    starting = false,
                    scanning = false,
                    port = port,
                    ip = ip,
                    trackCount = outcome.trackCount,
                    version = outcome.version,
                    warning = if (ip.isNullOrBlank()) {
                        "Не удалось определить IP. Проверьте подключение к Wi-Fi."
                    } else {
                        it.warning
                    },
                    error = null,
                )
            }
            updateNotification()
            Log.i(TAG, "Сервер запущен на порту $port, треков: ${outcome.trackCount}")
        } catch (e: SecurityException) {
            fail("Нет разрешения на чтение аудио. Выдайте доступ к музыке в настройках.")
        } catch (e: Exception) {
            Log.e(TAG, "Запуск сервера не удался: ${e.javaClass.simpleName}")
            fail("Не удалось запустить сервер: ${e.message ?: "неизвестная ошибка"}")
        }
    }

    private fun fail(message: String) {
        runCatching { server?.stop(200, 800) }
        server = null
        mdnsPort = null
        mdnsJob?.cancel()
        udpBeaconJob?.cancel()
        udpBeaconJob = null
        nsdPublisher?.stop()
        nsdPublisher = null
        ServerRuntime.update {
            it.copy(
                running = false,
                starting = false,
                scanning = false,
                error = message,
            )
        }
        updateNotification()
    }

    private fun publishMdns(port: Int) {
        nsdPublisher?.stop()
        val publisher = NsdPublisher(
            context = applicationContext,
            preferredName = "VibeCast-${Build.MODEL ?: "Android"}",
            port = port,
            token = tokenStore.token(),
            onFailure = { message ->
                Log.w(TAG, "mDNS: $message. Клиенты найдут сервер через LAN-скан или прямой адрес.")
            },
            onRegistered = {
                Log.i(TAG, "mDNS успешно зарегистрирован")
            },
        )
        // mDNS — вспомогательное удобство, а не условие работы сервера. Если регистрация
        // упала, телефон всё равно доступен через LAN-скан, UDP-маяк и прямой URL.
        runCatching { publisher.start() }.onFailure { error ->
            Log.w(TAG, "mDNS: запуск не удался: ${error.javaClass.simpleName}")
        }
        nsdPublisher = publisher
    }

    /**
     * Перерегистрирует mDNS при смене сети. Это лечит типовой случай, когда
     * сервис стартовал до подключения к Wi-Fi или телефон переключился между
     * сетями: NsdManager сам объявление не переносит.
     */
    private fun scheduleMdnsRefresh() {
        val port = mdnsPort ?: return
        mdnsJob?.cancel()
        mdnsJob = scope.launch {
            delay(1_200)
            if (started) publishMdns(port)
        }
    }

    private fun startNetworkMonitor() {
        if (networkCallback != null) return
        val manager = getSystemService(ConnectivityManager::class.java) ?: return
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                scheduleMdnsRefresh()
            }

            override fun onLost(network: Network) {
                scheduleMdnsRefresh()
            }
        }
        runCatching { manager.registerDefaultNetworkCallback(callback) }
            .onFailure { Log.w(TAG, "Сетевой монитор не зарегистрирован") }
        networkCallback = callback
    }

    private fun stopNetworkMonitor() {
        val manager = getSystemService(ConnectivityManager::class.java)
        val callback = networkCallback
        networkCallback = null
        if (manager != null && callback != null) {
            runCatching { manager.unregisterNetworkCallback(callback) }
        }
        mdnsJob?.cancel()
        mdnsJob = null
    }

    private fun startUdpBroadcast(port: Int) {
        udpBeaconJob?.cancel()
        udpBeaconJob = scope.launch(Dispatchers.IO) {
            val deviceModel = Build.MODEL ?: "Android"
            val token = tokenStore.token()
            val beaconPayload =
                """{"device_name":"$deviceModel","service":"audio_stream","port":$port,"version":"1","token_required":false,"token":"$token"}"""
                    .toByteArray(Charsets.UTF_8)
            var socket: DatagramSocket? = null
            try {
                socket = DatagramSocket()
                socket.broadcast = true
                val packet = DatagramPacket(
                    beaconPayload,
                    beaconPayload.size,
                    InetAddress.getByName("255.255.255.255"),
                    41234,
                )
                while (started && !stopped) {
                    try {
                        socket.send(packet)
                    } catch (e: Exception) {
                        Log.w(TAG, "UDP Beacon broadcast error: ${e.message}")
                    }
                    delay(3000)
                }
            } catch (e: Exception) {
                Log.w(TAG, "Failed to initialize UDP beacon socket: ${e.message}")
            } finally {
                socket?.close()
            }
        }
    }

    private fun scheduleRescan(delayMs: Long = 1_500) {
        rescanJob?.cancel()
        rescanJob = scope.launch {
            if (delayMs > 0) delay(delayMs)
            performRescan()
        }
    }

    private suspend fun performRescan() {
        val repo = repository ?: return
        ServerRuntime.update { it.copy(scanning = true) }
        updateNotification()
        try {
            val outcome = repo.rescan()
            ServerRuntime.update {
                it.copy(
                    scanning = false,
                    trackCount = outcome.trackCount,
                    version = outcome.version,
                    error = null,
                )
            }
        } catch (e: SecurityException) {
            ServerRuntime.update {
                it.copy(scanning = false, error = "Нет доступа к аудио — проверьте разрешение")
            }
        } catch (e: Exception) {
            ServerRuntime.update {
                it.copy(scanning = false, error = "Не удалось обновить библиотеку")
            }
        }
        updateNotification()
    }

    private fun registerMediaObserver() {
        if (contentObserver != null) return
        val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
            override fun onChange(selfChange: Boolean) {
                scheduleRescan()
            }
        }
        contentObserver = observer
        runCatching {
            contentResolver.registerContentObserver(
                MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                true,
                observer,
            )
        }.onFailure {
            Log.w(TAG, "ContentObserver не зарегистрирован")
        }
    }

    private fun shutdown() {
        if (stopped) return
        stopped = true
        started = false
        versionJob?.cancel()
        rescanJob?.cancel()
        runCatching { server?.stop(300, 1_200) }
        server = null
        mdnsPort = null
        stopNetworkMonitor()
        udpBeaconJob?.cancel()
        udpBeaconJob = null
        nsdPublisher?.stop()
        nsdPublisher = null
        contentObserver?.let { observer ->
            runCatching { contentResolver.unregisterContentObserver(observer) }
        }
        contentObserver = null
        releaseLocks()
        ServerRuntime.reset()
        runCatching {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
            NotificationManagerCompat.from(this).cancel(NOTIFICATION_ID)
        }
    }

    private fun acquireLocks() {
        runCatching {
            val power = getSystemService(PowerManager::class.java)
            wakeLock = power.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "VibeCast::Server",
            ).apply {
                setReferenceCounted(false)
                acquire()
            }
        }.onFailure { Log.w(TAG, "Не удалось взять WakeLock") }

        runCatching {
            val wifi = applicationContext.getSystemService(WifiManager::class.java)
            wifiLock = wifi.createWifiLock(
                WifiManager.WIFI_MODE_FULL_HIGH_PERF,
                "VibeCast::Wifi",
            ).apply {
                setReferenceCounted(false)
                acquire()
            }
        }.onFailure { Log.w(TAG, "Не удалось взять WifiLock") }

        // Отдельная попытка: без MulticastLock NsdManager может не видеть
        // multicast-трафик, даже если остальные блокировки взяты.
        runCatching {
            val wifi = applicationContext.getSystemService(WifiManager::class.java)
            multicastLock = wifi.createMulticastLock("VibeCast::Mdns").apply {
                setReferenceCounted(false)
                acquire()
            }
        }.onFailure { Log.w(TAG, "Не удалось взять MulticastLock") }
    }

    private fun releaseLocks() {
        runCatching { wakeLock?.takeIf { it.isHeld }?.release() }
        runCatching { wifiLock?.takeIf { it.isHeld }?.release() }
        runCatching { multicastLock?.takeIf { it.isHeld }?.release() }
        wakeLock = null
        wifiLock = null
        multicastLock = null
    }

    private fun findAvailablePort(preferred: Int): Int {
        for (port in preferred until preferred + 20) {
            try {
                ServerSocket().use { socket ->
                    socket.reuseAddress = true
                    socket.bind(InetSocketAddress(port))
                }
                return port
            } catch (_: Exception) {
                // порт занят — пробуем следующий
            }
        }
        throw IllegalStateException("Нет свободного порта в диапазоне $preferred..${preferred + 19}")
    }

    private fun localIpAddress(): String? {
        val interfaces = NetworkInterface.getNetworkInterfaces()?.toList().orEmpty()
            .filter { it.isUp && !it.isLoopback }
            .sortedByDescending { iface ->
                val name = iface.name.lowercase()
                name.contains("wlan") || name.contains("wifi") || name.contains("ap")
            }
        for (iface in interfaces) {
            for (address in iface.inetAddresses.toList()) {
                if (address is Inet4Address && address.isSiteLocalAddress && !address.isLoopbackAddress) {
                    return address.hostAddress
                }
            }
        }
        return null
    }

    private fun deviceLabel(): String =
        listOfNotNull(Build.MANUFACTURER?.takeIf { it.isNotBlank() }, Build.MODEL)
            .joinToString(" ")
            .trim()
            .ifBlank { "Android" }

    private fun startForegroundNow() {
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
        } else {
            0
        }
        ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(), type)
    }

    private fun updateNotification() {
        if (!started) return
        runCatching {
            NotificationManagerCompat.from(this).notify(NOTIFICATION_ID, buildNotification())
        }
    }

    private fun buildNotification(): Notification {
        val state = ServerRuntime.current()
        val text = when {
            state.error != null -> state.error
            state.scanning -> "Сканирование библиотеки…"
            state.running -> {
                val host = state.ip?.let { "$it:${state.port}" } ?: "порт ${state.port}"
                "${state.trackCount} треков · $host"
            }
            else -> "Запуск…"
        }
        val openIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val stopIntent = PendingIntent.getService(
            this,
            1,
            Intent(this, ServerService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_vibecast)
            .setContentTitle(getString(R.string.notification_title))
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(openIntent)
            .addAction(0, "Стоп", stopIntent)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.notification_channel_name),
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = getString(R.string.notification_channel_description)
            setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
    }

    companion object {
        private const val TAG = "VibeCastService"
        private const val CHANNEL_ID = "vibecast_server"
        private const val NOTIFICATION_ID = 1010
        private const val ACTION_START = "com.vibecast.app.action.START"
        private const val ACTION_STOP = "com.vibecast.app.action.STOP"
        private const val ACTION_RESCAN = "com.vibecast.app.action.RESCAN"

        fun start(context: Context) {
            val intent = Intent(context, ServerService::class.java).setAction(ACTION_START)
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            val intent = Intent(context, ServerService::class.java).setAction(ACTION_STOP)
            runCatching { context.startService(intent) }
        }

        fun rescan(context: Context) {
            val intent = Intent(context, ServerService::class.java).setAction(ACTION_RESCAN)
            runCatching { context.startService(intent) }
        }
    }
}
