package com.vibecast.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.core.view.WindowCompat
import com.vibecast.app.ui.VibeCastRoot
import com.vibecast.app.ui.theme.VibeCastTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        setContent {
            VibeCastTheme {
                VibeCastRoot()
            }
        }
    }
}
