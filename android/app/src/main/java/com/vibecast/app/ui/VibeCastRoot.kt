package com.vibecast.app.ui

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.vibecast.app.service.ServerRuntime
import com.vibecast.app.service.ServerService
import com.vibecast.app.ui.theme.VibeAmber
import com.vibecast.app.ui.theme.VibeBg
import com.vibecast.app.ui.theme.VibeGreen
import com.vibecast.app.ui.theme.VibeMuted
import com.vibecast.app.ui.theme.VibeRed
import com.vibecast.app.ui.theme.VibeSurface
import com.vibecast.app.ui.theme.VibeSurfaceHigh
import com.vibecast.app.ui.theme.VibeText
import com.vibecast.shared.ConnectionUrl

@Composable
fun VibeCastRoot() {
    val context = LocalContext.current
    var hasAudioAccess by remember { mutableStateOf(context.hasAudioPermission()) }
    val state by ServerRuntime.state.collectAsStateWithLifecycle()

    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestMultiplePermissions(),
    ) {
        hasAudioAccess = context.hasAudioPermission()
    }

    LaunchedEffect(hasAudioAccess) {
        if (hasAudioAccess) {
            val now = ServerRuntime.current()
            if (!now.running && !now.starting && !now.scanning) {
                ServerService.start(context)
            }
        }
    }

    Surface(color = VibeBg, modifier = Modifier.fillMaxSize()) {
        if (!hasAudioAccess) {
            PermissionScreen(
                onRequest = { permissionLauncher.launch(requiredPermissions()) },
                onOpenSettings = { context.openAppSettings() },
            )
        } else {
            StatusScreen(
                state = state,
                onStart = { ServerService.start(context) },
                onStop = { ServerService.stop(context) },
                onRescan = { ServerService.rescan(context) },
                onBatterySettings = { context.openBatterySettings() },
                onRefreshPermission = { hasAudioAccess = context.hasAudioPermission() },
            )
        }
    }
}

@Composable
private fun PermissionScreen(onRequest: () -> Unit, onOpenSettings: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 56.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            modifier = Modifier
                .size(88.dp)
                .clip(RoundedCornerShape(28.dp))
                .background(Brush.linearGradient(listOf(VibeGreen, Color(0xFF22D3EE)))),
            contentAlignment = Alignment.Center,
        ) {
            Text("▶", color = Color(0xFF06210F), fontSize = 38.sp, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.height(28.dp))
        Text(
            "VibeCast",
            color = VibeText,
            fontSize = 34.sp,
            fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(10.dp))
        Text(
            "Музыка с телефона — на большом экране",
            color = VibeMuted,
            fontSize = 16.sp,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(36.dp))
        Card(
            colors = CardDefaults.cardColors(containerColor = VibeSurface),
            shape = RoundedCornerShape(24.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(Modifier.padding(22.dp)) {
                Text("Нужен доступ к аудио", color = VibeText, fontWeight = FontWeight.SemiBold, fontSize = 18.sp)
                Spacer(Modifier.height(10.dp))
                Text(
                    "VibeCast читает локальные аудиофайлы через MediaStore, чтобы показать их на ПК. " +
                        "Файлы не загружаются в интернет — передача идёт только по вашему Wi-Fi.",
                    color = VibeMuted,
                    fontSize = 14.sp,
                )
                Spacer(Modifier.height(14.dp))
                Bullet("Доступ к аудиотеке")
                if (Build.VERSION.SDK_INT >= 33) Bullet("Уведомления — для статуса раздачи")
                Spacer(Modifier.height(22.dp))
                Button(
                    onClick = onRequest,
                    modifier = Modifier.fillMaxWidth().height(50.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = VibeGreen),
                    shape = RoundedCornerShape(14.dp),
                ) {
                    Text("Разрешить доступ", color = Color(0xFF06210F), fontWeight = FontWeight.Bold)
                }
                Spacer(Modifier.height(10.dp))
                OutlinedButton(
                    onClick = onOpenSettings,
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                    shape = RoundedCornerShape(14.dp),
                ) {
                    Text("Открыть настройки", color = VibeText)
                }
            }
        }
        Spacer(Modifier.height(24.dp))
        Text(
            "Совет: телефон и ПК должны быть в одной Wi-Fi сети.",
            color = VibeMuted,
            fontSize = 13.sp,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun Bullet(text: String) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 3.dp)) {
        Box(Modifier.size(6.dp).clip(CircleShape).background(VibeGreen))
        Spacer(Modifier.width(10.dp))
        Text(text, color = VibeMuted, fontSize = 13.sp)
    }
}

@Composable
private fun StatusScreen(
    state: ServerRuntime.State,
    onStart: () -> Unit,
    onStop: () -> Unit,
    onRescan: () -> Unit,
    onBatterySettings: () -> Unit,
    onRefreshPermission: () -> Unit,
) {
    LaunchedEffect(Unit) { onRefreshPermission() }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 48.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(42.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(Brush.linearGradient(listOf(VibeGreen, Color(0xFF22D3EE)))),
                contentAlignment = Alignment.Center,
            ) {
                Text("▶", color = Color(0xFF06210F), fontSize = 20.sp, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.width(12.dp))
            Column {
                Text("VibeCast", color = VibeText, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                Text("Android → ПК", color = VibeMuted, fontSize = 12.sp)
            }
        }

        Spacer(Modifier.height(24.dp))
        StatusCard(state)

        AnimatedVisibility(visible = state.error != null) {
            Banner(
                text = state.error.orEmpty(),
                color = VibeRed,
                modifier = Modifier.padding(top = 12.dp),
            )
        }
        AnimatedVisibility(visible = state.warning != null) {
            Banner(
                text = state.warning.orEmpty(),
                color = VibeAmber,
                modifier = Modifier.padding(top = 12.dp),
            )
        }

        if (state.running && state.ip != null) {
            Spacer(Modifier.height(16.dp))
            QrCard(state)
        }

        Spacer(Modifier.height(16.dp))
        Card(
            colors = CardDefaults.cardColors(containerColor = VibeSurface),
            shape = RoundedCornerShape(20.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(Modifier.padding(18.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (state.running || state.starting) {
                        OutlinedButton(
                            onClick = onStop,
                            modifier = Modifier.weight(1f).height(48.dp),
                            shape = RoundedCornerShape(12.dp),
                        ) { Text("Остановить", color = VibeText) }
                    } else {
                        Button(
                            onClick = onStart,
                            modifier = Modifier.weight(1f).height(48.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = VibeGreen),
                            shape = RoundedCornerShape(12.dp),
                        ) { Text("Запустить", color = Color(0xFF06210F), fontWeight = FontWeight.Bold) }
                    }
                    Button(
                        onClick = onRescan,
                        enabled = state.running && !state.scanning,
                        modifier = Modifier.weight(1f).height(48.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = VibeSurfaceHigh),
                        shape = RoundedCornerShape(12.dp),
                    ) {
                        Text(
                            if (state.scanning) "Сканирую…" else "Пересканировать",
                            color = VibeText,
                        )
                    }
                }
                Spacer(Modifier.height(10.dp))
                OutlinedButton(
                    onClick = onBatterySettings,
                    modifier = Modifier.fillMaxWidth().height(46.dp),
                    shape = RoundedCornerShape(12.dp),
                ) {
                    Text("Разрешить работу в фоне", color = VibeText)
                }
                Spacer(Modifier.height(8.dp))
                Text(
                    "Отключите оптимизацию батареи, чтобы сервер переживал выключенный экран.",
                    color = VibeMuted,
                    fontSize = 12.sp,
                )
            }
        }

        Spacer(Modifier.height(16.dp))
        Card(
            colors = CardDefaults.cardColors(containerColor = VibeSurface),
            shape = RoundedCornerShape(20.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(Modifier.padding(18.dp)) {
                Text("Подключение с ПК", color = VibeText, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(8.dp))
                Text(
                    "В приложении VibeCast на ПК выберите телефон из списка или введите адрес " +
                        "и токен вручную. QR-код содержит всё необходимое.",
                    color = VibeMuted,
                    fontSize = 13.sp,
                )
                Spacer(Modifier.height(14.dp))
                HorizontalDivider(color = Color(0xFF223040))
                Spacer(Modifier.height(14.dp))
                Text("Статус фоновой работы", color = VibeMuted, fontSize = 12.sp)
                Spacer(Modifier.height(4.dp))
                Text(
                    "Сервер живёт в foreground-сервисе с WakeLock и WifiLock. " +
                        "Уведомление «VibeCast раздаёт библиотеку» должно оставаться в шторке.",
                    color = VibeMuted,
                    fontSize = 12.sp,
                )
            }
        }
    }
}

@Composable
private fun StatusCard(state: ServerRuntime.State) {
    val statusColor = when {
        state.error != null -> VibeRed
        state.running -> VibeGreen
        state.starting || state.scanning -> VibeAmber
        else -> VibeMuted
    }
    val title = when {
        state.error != null -> "Сервер не запущен"
        state.scanning -> "Сканирование библиотеки…"
        state.starting -> "Запуск сервера…"
        state.running -> "Сервер работает"
        else -> "Сервер остановлен"
    }
    Card(
        colors = CardDefaults.cardColors(containerColor = VibeSurface),
        shape = RoundedCornerShape(24.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(20.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(10.dp).clip(CircleShape).background(statusColor))
                Spacer(Modifier.width(10.dp))
                Text(title, color = VibeText, fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
            }
            Spacer(Modifier.height(16.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Metric("Адрес", if (state.running && state.ip != null) "${state.ip}:${state.port}" else "—")
                Metric("Треков", if (state.trackCount > 0) state.trackCount.toString() else "—")
                Metric("Версия", if (state.version > 0) "#${state.version}" else "—")
            }
            if (state.token.isNotBlank()) {
                Spacer(Modifier.height(18.dp))
                TokenRow(state.token)
            }
        }
    }
}

@Composable
private fun Metric(label: String, value: String) {
    Column {
        Text(label, color = VibeMuted, fontSize = 11.sp)
        Spacer(Modifier.height(4.dp))
        Text(value, color = VibeText, fontSize = 15.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun TokenRow(token: String) {
    var revealed by remember { mutableStateOf(false) }
    val clipboard = LocalClipboardManager.current
    Column {
        Text("Bearer-токен", color = VibeMuted, fontSize = 11.sp)
        Spacer(Modifier.height(6.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = if (revealed) token else "•".repeat(18),
                color = VibeText,
                fontSize = 13.sp,
                modifier = Modifier.weight(1f),
            )
            TextButtonText(if (revealed) "Скрыть" else "Показать") { revealed = !revealed }
            Spacer(Modifier.width(8.dp))
            TextButtonText("Копировать") {
                clipboard.setText(AnnotatedString(token))
            }
        }
    }
}

@Composable
private fun TextButtonText(text: String, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 10.dp, vertical = 4.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = VibeSurfaceHigh,
            contentColor = VibeGreen,
        ),
        shape = RoundedCornerShape(8.dp),
        modifier = Modifier.height(32.dp),
    ) {
        Text(text, fontSize = 12.sp)
    }
}

@Composable
private fun QrCard(state: ServerRuntime.State) {
    val ip = state.ip ?: return
    val url = remember(ip, state.port, state.token) {
        ConnectionUrl.build(ip, state.port, state.token)
    }
    val bitmap = remember(url) { generateQrBitmap(url, 640) }
    Card(
        colors = CardDefaults.cardColors(containerColor = Color.White),
        shape = RoundedCornerShape(24.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(18.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            if (bitmap != null) {
                Image(
                    bitmap = bitmap.asImageBitmap(),
                    contentDescription = "QR-код для подключения",
                    modifier = Modifier.size(230.dp),
                )
            } else {
                Text("Не удалось построить QR-код", color = Color.Black)
            }
            Spacer(Modifier.height(10.dp))
            Text(
                "Отсканируйте QR в VibeCast на ПК",
                color = Color(0xFF0B0F14),
                fontWeight = FontWeight.SemiBold,
                fontSize = 14.sp,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                "http://$ip:${state.port}",
                color = Color(0xFF475569),
                fontSize = 12.sp,
            )
        }
    }
}

@Composable
private fun Banner(text: String, color: Color, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(color.copy(alpha = 0.12f))
            .border(1.dp, color.copy(alpha = 0.35f), RoundedCornerShape(14.dp))
            .padding(14.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Box(Modifier.size(8.dp).clip(CircleShape).background(color).align(Alignment.CenterVertically))
        Spacer(Modifier.width(10.dp))
        Text(text, color = VibeText, fontSize = 13.sp)
    }
}

private fun generateQrBitmap(content: String, size: Int): Bitmap? {
    return try {
        val matrix = QRCodeWriter().encode(
            content,
            BarcodeFormat.QR_CODE,
            size,
            size,
            mapOf(EncodeHintType.MARGIN to 1),
        )
        val pixels = IntArray(size * size)
        for (y in 0 until size) {
            val row = y * size
            for (x in 0 until size) {
                pixels[row + x] = if (matrix.get(x, y)) 0xFF000000.toInt() else 0xFFFFFFFF.toInt()
            }
        }
        Bitmap.createBitmap(pixels, size, size, Bitmap.Config.ARGB_8888)
    } catch (_: Throwable) {
        null
    }
}

private fun Context.hasAudioPermission(): Boolean {
    val permission = if (Build.VERSION.SDK_INT >= 33) {
        Manifest.permission.READ_MEDIA_AUDIO
    } else {
        Manifest.permission.READ_EXTERNAL_STORAGE
    }
    return ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED
}

private fun requiredPermissions(): Array<String> {
    val permissions = mutableListOf<String>()
    if (Build.VERSION.SDK_INT >= 33) {
        permissions += Manifest.permission.READ_MEDIA_AUDIO
        permissions += Manifest.permission.POST_NOTIFICATIONS
    } else {
        permissions += Manifest.permission.READ_EXTERNAL_STORAGE
    }
    return permissions.toTypedArray()
}

private fun Context.openAppSettings() {
    runCatching {
        startActivity(
            Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:$packageName"),
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }
}

private fun Context.openBatterySettings() {
    runCatching {
        startActivity(
            Intent(
                Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                Uri.parse("package:$packageName"),
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }.onFailure {
        runCatching {
            startActivity(
                Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        }
    }
}
