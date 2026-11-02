package com.vibecast.app.service

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.vibecast.shared.HealthDto

/**
 * Публикация _vibecast._tcp. Токен НЕ передаётся в TXT: только версия протокола и
 * признак необходимости авторизации.
 *
 * NsdManager на части прошивок не успевает зарегистрировать сервис, если Wi-Fi
 * ещё не поднялся. Поэтому делаем несколько попыток с паузой. Повторный start()
 * не создаёт вторую регистрацию — старую нужно остановить через stop().
 */
class NsdPublisher(
    context: Context,
    private val preferredName: String,
    private val port: Int,
    private val token: String = "",
    private val onFailure: (String) -> Unit,
    private val onRegistered: () -> Unit = {},
) {
    private val nsdManager = context.applicationContext
        .getSystemService(Context.NSD_SERVICE) as? NsdManager

    private val mainHandler = Handler(Looper.getMainLooper())
    private var listener: NsdManager.RegistrationListener? = null
    private var active = false
    private var attempts = 0

    fun start() {
        if (active) return
        active = true
        attempts = 0
        register()
    }

    private fun register() {
        if (!active) return
        val manager = nsdManager ?: run {
            Log.w(TAG, "mDNS: NsdManager недоступен на данном устройстве")
            onFailure("mDNS недоступен")
            return
        }

        val info = NsdServiceInfo().apply {
            // Нельзя читать serviceName у самого NsdServiceInfo: до присваивания
            // платформенное поле равно null (был краш getServiceName(...) must not be null).
            serviceName = sanitizeName(preferredName)
            serviceType = SERVICE_TYPE
            setPort(port)
            setAttribute("version", HealthDto.PROTOCOL_VERSION.toString())
            setAttribute("token_required", "0")
            if (token.isNotBlank()) {
                setAttribute("token", token)
            }
            setAttribute("device", android.os.Build.MODEL ?: "Android")
        }

        val registration = object : NsdManager.RegistrationListener {
            override fun onServiceRegistered(info: NsdServiceInfo) {
                if (!active) return
                attempts = 0
                Log.i(TAG, "mDNS: опубликован ${info.serviceName ?: "(без имени)"}")
                onRegistered()
            }

            override fun onRegistrationFailed(info: NsdServiceInfo, errorCode: Int) {
                if (!active) return
                listener = null
                Log.w(TAG, "mDNS: регистрация не удалась, код $errorCode, попытка ${attempts + 1}")
                retryOrFail()
            }

            override fun onServiceUnregistered(info: NsdServiceInfo) {
                Log.i(TAG, "mDNS: регистрация снята")
            }

            override fun onUnregistrationFailed(info: NsdServiceInfo, errorCode: Int) {
                Log.w(TAG, "mDNS: отмена регистрации не удалась, код $errorCode")
            }
        }
        listener = registration
        runCatching {
            manager.registerService(info, NsdManager.PROTOCOL_DNS_SD, registration)
        }.onFailure {
            if (!active) return
            listener = null
            Log.w(TAG, "mDNS: registerService выбросил исключение")
            retryOrFail()
        }
    }

    private fun retryOrFail() {
        attempts += 1
        if (attempts < MAX_ATTEMPTS) {
            val delayMs = RETRY_DELAY_MS * attempts
            mainHandler.postDelayed({ register() }, delayMs)
        } else {
            Log.w(TAG, "mDNS: регистрация не удалась после $MAX_ATTEMPTS попыток")
            onFailure("mDNS недоступен")
        }
    }

    fun stop() {
        active = false
        mainHandler.removeCallbacksAndMessages(null)
        val current = listener
        listener = null
        val manager = nsdManager ?: return
        if (current != null) {
            // unregisterService вызываем даже если onServiceRegistered ещё не пришёл:
            // иначе на некоторых прошивках остаётся «висящая» регистрация.
            runCatching { manager.unregisterService(current) }
                .onFailure { Log.w(TAG, "mDNS: ошибка остановки") }
        }
    }

    companion object {
        private const val TAG = "VibeCastNsd"
        private const val SERVICE_TYPE = "_vibecast._tcp"
        private const val MAX_ATTEMPTS = 3
        private const val RETRY_DELAY_MS = 1_200L

        /**
         * DNS-SD instance name должен быть валидной меткой. Кириллица и пробелы
         * поддерживаются не всеми реализациями mDNS, поэтому оставляем ASCII.
         */
        private fun sanitizeName(value: String): String {
            val cleaned = value.trim()
                .replace(Regex("[^A-Za-z0-9 ._-]"), "")
                .replace(Regex("\\s+"), "-")
                .trim('-', '.', '_')
            return cleaned.take(50).ifBlank { "VibeCast" }
        }
    }
}
