package com.vibecast.app.service

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/** Наблюдаемое состояние сервера для Compose UI (живёт в процессе приложения). */
object ServerRuntime {

    data class State(
        val running: Boolean = false,
        val starting: Boolean = false,
        val scanning: Boolean = false,
        val port: Int = 8765,
        val ip: String? = null,
        val trackCount: Int = 0,
        val version: Long = 0,
        val token: String = "",
        val deviceName: String = "",
        val error: String? = null,
        val warning: String? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    internal fun update(transform: (State) -> State) {
        _state.update(transform)
    }

    internal fun reset() {
        _state.value = State()
    }

    internal fun current(): State = _state.value
}
