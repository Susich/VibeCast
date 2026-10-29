package com.vibecast.app.service

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.util.Log
import com.vibecast.shared.HealthDto

/**
 * Публикация _vibecast._tcp. Токен НЕ передаётся в TXT: только версия протокола и
 * признак необходимости авторизации.
 */
class NsdPublisher(
    context: Context,
    private val serviceName: String,
    private val port: Int,
    private val onFailure: (String) -> Unit,
) {
    private val nsdManager = context.applicationContext
        .getSystemService(Context.NSD_SERVICE) as? NsdManager

    private var listener: NsdManager.RegistrationListener? = null
    private var registered = false

    fun start() {
        val manager = nsdManager ?: run {
            onFailure("mDNS недоступен на устройстве")
            return
        }
        val info = NsdServiceInfo().apply {
            serviceName = serviceName.take(60)
            serviceType = SERVICE_TYPE
            setPort(port)
            setAttribute("version", HealthDto.PROTOCOL_VERSION.toString())
            setAttribute("token_required", "1")
            setAttribute("device", android.os.Build.MODEL ?: "Android")
        }
        val registration = object : NsdManager.RegistrationListener {
            override fun onServiceRegistered(info: NsdServiceInfo) {
                registered = true
                Log.i(TAG, "mDNS: опубликован ${info.serviceName}")
            }

            override fun onRegistrationFailed(info: NsdServiceInfo, errorCode: Int) {
                registered = false
                Log.w(TAG, "mDNS: регистрация не удалась, код $errorCode")
                onFailure("mDNS недоступен — подключитесь по URL вручную")
            }

            override fun onServiceUnregistered(info: NsdServiceInfo) {
                registered = false
            }

            override fun onUnregistrationFailed(info: NsdServiceInfo, errorCode: Int) {
                Log.w(TAG, "mDNS: отмена регистрации не удалась, код $errorCode")
            }
        }
        listener = registration
        runCatching {
            manager.registerService(info, NsdManager.PROTOCOL_DNS_SD, registration)
        }.onFailure {
            Log.w(TAG, "mDNS: registerService выбросил исключение")
            onFailure("mDNS недоступен — подключитесь по URL вручную")
        }
    }

    fun stop() {
        val manager = nsdManager ?: return
        val current = listener ?: return
        listener = null
        runCatching {
            if (registered) manager.unregisterService(current)
        }.onFailure {
            Log.w(TAG, "mDNS: ошибка остановки")
        }
        registered = false
    }

    companion object {
        private const val TAG = "VibeCastNsd"
        private const val SERVICE_TYPE = "_vibecast._tcp"
    }
}
