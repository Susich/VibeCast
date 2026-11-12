package com.vibecast.app.ui

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Sort
import androidx.compose.material.icons.automirrored.rounded.VolumeMute
import androidx.compose.material.icons.automirrored.rounded.VolumeUp
import androidx.compose.material.icons.rounded.ArrowDropDown
import androidx.compose.material.icons.rounded.BatteryChargingFull
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.ContentCopy
import androidx.compose.material.icons.rounded.FolderOpen
import androidx.compose.material.icons.rounded.Headphones
import androidx.compose.material.icons.rounded.MusicNote
import androidx.compose.material.icons.rounded.Palette
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Sensors
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material.icons.rounded.SkipNext
import androidx.compose.material.icons.rounded.SkipPrevious
import androidx.compose.material.icons.rounded.SystemUpdate
import androidx.compose.material.icons.rounded.Update
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vibecast.app.BuildConfig
import com.vibecast.app.data.AppUpdateInfo
import com.vibecast.app.data.CoverStore
import com.vibecast.app.data.FolderInfo
import com.vibecast.app.data.TrackSort
import com.vibecast.app.data.UpdateManager
import com.vibecast.app.service.ServerRuntime
import com.vibecast.app.service.ServerService
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import com.vibecast.app.data.ThemePreferences
import com.vibecast.app.ui.theme.VibeAmber
import com.vibecast.app.ui.theme.VibeBg
import com.vibecast.app.ui.theme.VibeBgGradientBottom
import com.vibecast.app.ui.theme.VibeBgGradientTop
import com.vibecast.app.ui.theme.VibeCyan
import com.vibecast.app.ui.theme.VibeGreen
import com.vibecast.app.ui.theme.VibeMuted
import com.vibecast.app.ui.theme.VibeRed
import com.vibecast.app.ui.theme.VibeSurface
import com.vibecast.app.ui.theme.VibeSurfaceBorder
import com.vibecast.app.ui.theme.VibeSurfaceHigh
import com.vibecast.app.ui.theme.VibeText
import com.vibecast.app.ui.theme.VibeTheme
import com.vibecast.app.ui.theme.VibeThemes
import com.vibecast.shared.PlayerStateDto
import com.vibecast.shared.RemoteCommandDto
import com.vibecast.shared.TrackDto
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private enum class NavTab(val title: String, val icon: ImageVector) {
    PLAYER("Пульт", Icons.Rounded.Headphones),
    SERVER("Сервер", Icons.Rounded.Sensors),
    SHARE("Ещё", Icons.Rounded.Palette),
}

@Composable
private fun MiniEqualizerWave(
    isPlaying: Boolean,
    modifier: Modifier = Modifier,
    barColor: Color = VibeGreen,
) {
    if (!isPlaying) {
        Row(
            modifier = modifier.height(14.dp),
            horizontalArrangement = Arrangement.spacedBy(2.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            Box(Modifier.width(2.5.dp).height(4.dp).clip(RoundedCornerShape(1.dp)).background(barColor.copy(alpha = 0.4f)))
            Box(Modifier.width(2.5.dp).height(7.dp).clip(RoundedCornerShape(1.dp)).background(barColor.copy(alpha = 0.4f)))
            Box(Modifier.width(2.5.dp).height(3.dp).clip(RoundedCornerShape(1.dp)).background(barColor.copy(alpha = 0.4f)))
        }
        return
    }

    val transition = rememberInfiniteTransition(label = "eqWave")
    val h1 by transition.animateFloat(
        initialValue = 4f,
        targetValue = 13f,
        animationSpec = infiniteRepeatable(tween(360, easing = FastOutSlowInEasing), RepeatMode.Reverse),
        label = "h1",
    )
    val h2 by transition.animateFloat(
        initialValue = 14f,
        targetValue = 5f,
        animationSpec = infiniteRepeatable(tween(440, easing = LinearEasing), RepeatMode.Reverse),
        label = "h2",
    )
    val h3 by transition.animateFloat(
        initialValue = 5f,
        targetValue = 15f,
        animationSpec = infiniteRepeatable(tween(310, easing = FastOutSlowInEasing), RepeatMode.Reverse),
        label = "h3",
    )

    Row(
        modifier = modifier.height(15.dp),
        horizontalArrangement = Arrangement.spacedBy(2.5.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        Box(Modifier.width(2.5.dp).height(h1.dp).clip(RoundedCornerShape(1.dp)).background(barColor))
        Box(Modifier.width(2.5.dp).height(h2.dp).clip(RoundedCornerShape(1.dp)).background(barColor))
        Box(Modifier.width(2.5.dp).height(h3.dp).clip(RoundedCornerShape(1.dp)).background(barColor))
    }
}

@Composable
private fun ServerLivePulse(isActive: Boolean) {
    if (!isActive) {
        Box(Modifier.size(10.dp).clip(CircleShape).background(VibeMuted))
        return
    }
    val transition = rememberInfiniteTransition(label = "pulse")
    val scale by transition.animateFloat(
        initialValue = 1f,
        targetValue = 1.7f,
        animationSpec = infiniteRepeatable(tween(900, easing = FastOutSlowInEasing), RepeatMode.Reverse),
        label = "scale",
    )
    val alpha by transition.animateFloat(
        initialValue = 0.65f,
        targetValue = 0.05f,
        animationSpec = infiniteRepeatable(tween(900, easing = FastOutSlowInEasing), RepeatMode.Reverse),
        label = "alpha",
    )

    Box(contentAlignment = Alignment.Center, modifier = Modifier.size(18.dp)) {
        Box(
            Modifier
                .size((11 * scale).dp)
                .clip(CircleShape)
                .background(VibeGreen.copy(alpha = alpha)),
        )
        Box(Modifier.size(9.dp).clip(CircleShape).background(VibeGreen))
    }
}

@Composable
fun VibeCastRoot() {
    val context = LocalContext.current
    var hasAudioAccess by remember { mutableStateOf(context.hasAudioPermission()) }
    val state by ServerRuntime.state.collectAsStateWithLifecycle()
    var selectedTab by remember { mutableStateOf(NavTab.PLAYER) }

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
            Scaffold(
                containerColor = Color.Transparent,
                bottomBar = {
                    VibeBottomNav(
                        currentTab = selectedTab,
                        onTabSelected = { selectedTab = it },
                    )
                },
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            listOf(VibeBgGradientTop, VibeBg, VibeBgGradientBottom)
                        )
                    ),
            ) { padding ->
                Box(
                    modifier = Modifier
                        .padding(padding)
                        .fillMaxSize(),
                ) {
                    when (selectedTab) {
                        NavTab.PLAYER -> RemotePlayerScreen(
                            onNavigateToServer = { selectedTab = NavTab.SERVER },
                        )
                        NavTab.SERVER -> StatusScreen(
                            state = state,
                            onStart = { ServerService.start(context) },
                            onStop = { ServerService.stop(context) },
                            onRescan = { ServerService.rescan(context) },
                            onBatterySettings = { context.openBatterySettings() },
                            onRefreshPermission = { hasAudioAccess = context.hasAudioPermission() },
                        )
                        NavTab.SHARE -> ShareAndUpdatesScreen()
                    }
                }
            }
        }
    }
}

@Composable
private fun VibeBottomNav(
    currentTab: NavTab,
    onTabSelected: (NavTab) -> Unit,
) {
    Surface(
        color = VibeSurface.copy(alpha = 0.95f),
        shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp),
        border = BorderStroke(1.dp, VibeSurfaceBorder.copy(alpha = 0.6f)),
        tonalElevation = 8.dp,
        modifier = Modifier.fillMaxWidth(),
    ) {
        NavigationBar(
            containerColor = Color.Transparent,
            tonalElevation = 0.dp,
            modifier = Modifier.padding(top = 2.dp, bottom = 4.dp),
        ) {
            NavTab.values().forEach { tab ->
                val isSelected = currentTab == tab
                NavigationBarItem(
                    selected = isSelected,
                    onClick = { onTabSelected(tab) },
                    icon = {
                        Icon(
                            imageVector = tab.icon,
                            contentDescription = tab.title,
                            modifier = Modifier.size(22.dp),
                            tint = if (isSelected) VibeGreen else VibeMuted,
                        )
                    },
                    label = {
                        Text(
                            tab.title,
                            color = if (isSelected) VibeGreen else VibeMuted,
                            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
                            fontSize = 12.sp,
                        )
                    },
                    colors = NavigationBarItemDefaults.colors(
                        indicatorColor = VibeGreen.copy(alpha = 0.16f),
                    ),
                )
            }
        }
    }
}

@Composable
private fun RemotePlayerScreen(
    onNavigateToServer: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val playerState by ServerRuntime.playerState.collectAsStateWithLifecycle(initialValue = null)
    val runtimeState by ServerRuntime.state.collectAsStateWithLifecycle()

    var searchQuery by remember { mutableStateOf("") }
    var currentSort by remember { mutableStateOf(TrackSort.TITLE_ASC) }
    var showSortMenu by remember { mutableStateOf(false) }
    var showFolderDialog by remember { mutableStateOf(false) }
    var showThemeDialog by remember { mutableStateOf(false) }

    val repo = ServerRuntime.repository
    val tracks = remember(searchQuery, currentSort, repo, runtimeState.version, runtimeState.trackCount) {
        repo?.page(0, 150, searchQuery, currentSort)?.tracks ?: emptyList()
    }

    val selectedFolders = remember(runtimeState.version) {
        repo?.getSelectedFolders() ?: emptySet()
    }

    if (showThemeDialog) {
        ThemeSelectionDialog(onDismiss = { showThemeDialog = false })
    }

    if (showFolderDialog && repo != null) {
        FolderSelectionDialog(
            repo = repo,
            onDismiss = { showFolderDialog = false },
            onApply = { folders ->
                showFolderDialog = false
                scope.launch {
                    repo.setSelectedFolders(folders)
                    ServerService.rescan(context)
                }
            },
        )
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 16.dp),
    ) {
        // App / Screen Header
        item {
            Spacer(Modifier.height(18.dp))
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Box(
                    modifier = Modifier
                        .size(46.dp)
                        .clip(RoundedCornerShape(14.dp))
                        .background(Brush.linearGradient(listOf(VibeGreen, VibeCyan)))
                        .border(1.dp, Color(0x33FFFFFF), RoundedCornerShape(14.dp)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = Icons.Rounded.Headphones,
                        contentDescription = "Пульт",
                        tint = Color(0xFF06210F),
                        modifier = Modifier.size(24.dp),
                    )
                }
                Spacer(Modifier.width(12.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "Пульт VibeCast",
                            color = VibeText,
                            fontSize = 20.sp,
                            fontWeight = FontWeight.Bold,
                        )
                        Spacer(Modifier.width(8.dp))
                        val isPcActive = playerState?.currentTrackId != null
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(6.dp))
                                .background(if (isPcActive) VibeGreen.copy(alpha = 0.16f) else Color(0x1F94A3B8))
                                .padding(horizontal = 7.dp, vertical = 2.dp),
                        ) {
                            Text(
                                if (isPcActive) "ПК на связи" else "Ожидание",
                                color = if (isPcActive) VibeGreen else VibeMuted,
                                fontSize = 10.sp,
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                    }
                    Text(
                        "Воспроизведение музыки на компьютере по Wi-Fi",
                        color = VibeMuted,
                        fontSize = 12.sp,
                    )
                }
                Spacer(Modifier.width(8.dp))
                IconButton(
                    onClick = { showThemeDialog = true },
                    modifier = Modifier
                        .size(40.dp)
                        .clip(CircleShape)
                        .background(VibeSurfaceHigh)
                        .border(1.dp, VibeSurfaceBorder, CircleShape),
                ) {
                    Icon(
                        imageVector = Icons.Rounded.Palette,
                        contentDescription = "Темы оформления",
                        tint = VibeGreen,
                        modifier = Modifier.size(20.dp),
                    )
                }
            }
            Spacer(Modifier.height(16.dp))
        }

        // Now Playing Card
        item {
            val currentId = playerState?.currentTrackId
            val currentIndex = remember(currentId, tracks) {
                if (currentId != null) tracks.indexOfFirst { it.id == currentId } else -1
            }

            NowPlayingCard(
                player = playerState,
                onNavigateToServer = onNavigateToServer,
                onNext = {
                    if (tracks.isNotEmpty()) {
                        val nextIndex = if (currentIndex in 0 until tracks.lastIndex) {
                            currentIndex + 1
                        } else if (currentIndex == tracks.lastIndex) {
                            0
                        } else {
                            0
                        }
                        val nextTrack = tracks[nextIndex]
                        ServerRuntime.sendCommand(
                            RemoteCommandDto(
                                action = "play_track",
                                trackId = nextTrack.id,
                                queueIds = tracks.take(150).map { it.id },
                            ),
                        )
                    } else {
                        ServerRuntime.sendCommand(RemoteCommandDto(action = "next"))
                    }
                },
                onPrev = {
                    val pos = playerState?.position ?: 0.0
                    if (pos > 3.0) {
                        ServerRuntime.sendCommand(RemoteCommandDto(action = "seek", position = 0.0))
                    } else if (tracks.isNotEmpty()) {
                        val prevIndex = if (currentIndex > 0) {
                            currentIndex - 1
                        } else if (currentIndex == 0) {
                            tracks.lastIndex
                        } else {
                            0
                        }
                        val prevTrack = tracks[prevIndex]
                        ServerRuntime.sendCommand(
                            RemoteCommandDto(
                                action = "play_track",
                                trackId = prevTrack.id,
                                queueIds = tracks.take(150).map { it.id },
                            ),
                        )
                    } else {
                        ServerRuntime.sendCommand(RemoteCommandDto(action = "prev"))
                    }
                },
            )
            Spacer(Modifier.height(20.dp))
        }

        // Library Header
        item {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 4.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "Медиатека на телефоне",
                    color = VibeText,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold,
                )
                Surface(
                    color = VibeSurfaceHigh,
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.border(1.dp, VibeSurfaceBorder, RoundedCornerShape(8.dp)),
                ) {
                    Text(
                        text = "${runtimeState.trackCount} треков",
                        color = VibeMuted,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                    )
                }
            }

            Spacer(Modifier.height(8.dp))

            // Full-Width Sleek Search Field
            OutlinedTextField(
                value = searchQuery,
                onValueChange = { searchQuery = it },
                placeholder = {
                    Text(
                        "Поиск трека, артиста или альбома…",
                        color = VibeMuted,
                        fontSize = 13.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                },
                singleLine = true,
                maxLines = 1,
                leadingIcon = {
                    Icon(
                        imageVector = Icons.Rounded.Search,
                        contentDescription = "Поиск",
                        tint = if (searchQuery.isNotEmpty()) VibeGreen else VibeMuted,
                        modifier = Modifier.size(20.dp),
                    )
                },
                trailingIcon = {
                    if (searchQuery.isNotEmpty()) {
                        IconButton(onClick = { searchQuery = "" }) {
                            Icon(
                                imageVector = Icons.Rounded.Close,
                                contentDescription = "Очистить",
                                tint = VibeMuted,
                                modifier = Modifier.size(18.dp),
                            )
                        }
                    }
                },
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(14.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = VibeGreen,
                    unfocusedBorderColor = VibeSurfaceBorder,
                    focusedContainerColor = VibeSurface,
                    unfocusedContainerColor = VibeSurface,
                    focusedTextColor = VibeText,
                    unfocusedTextColor = VibeText,
                    cursorColor = VibeGreen,
                ),
            )

            Spacer(Modifier.height(10.dp))

            // Filter & Folder Action Bar
            val isFolderFiltered = selectedFolders.isNotEmpty()
            val isSortFiltered = currentSort != TrackSort.TITLE_ASC

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // Folder Button
                Surface(
                    onClick = { showFolderDialog = true },
                    modifier = Modifier
                        .weight(1f)
                        .height(40.dp)
                        .border(
                            1.dp,
                            if (isFolderFiltered) VibeGreen.copy(alpha = 0.6f) else Color(0xFF2A3848),
                            RoundedCornerShape(12.dp),
                        ),
                    shape = RoundedCornerShape(12.dp),
                    color = if (isFolderFiltered) Color(0xFF0F261B) else VibeSurfaceHigh,
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(horizontal = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.Center,
                    ) {
                        Icon(
                            imageVector = Icons.Rounded.FolderOpen,
                            contentDescription = "Папки",
                            modifier = Modifier.size(17.dp),
                            tint = if (isFolderFiltered) VibeGreen else VibeMuted,
                        )
                        Spacer(Modifier.width(7.dp))
                        Text(
                            text = if (!isFolderFiltered) "Папки" else "Папки (${selectedFolders.size})",
                            color = if (isFolderFiltered) VibeGreen else VibeText,
                            fontSize = 13.sp,
                            fontWeight = if (isFolderFiltered) FontWeight.SemiBold else FontWeight.Medium,
                            maxLines = 1,
                        )
                        Spacer(Modifier.width(4.dp))
                        Icon(
                            imageVector = Icons.Rounded.ArrowDropDown,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp),
                            tint = if (isFolderFiltered) VibeGreen else VibeMuted,
                        )
                    }
                }

                // Filter / Sort Dropdown Button
                Box(modifier = Modifier.weight(1f)) {
                    Surface(
                        onClick = { showSortMenu = true },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(40.dp)
                            .border(
                                1.dp,
                                if (isSortFiltered) VibeGreen.copy(alpha = 0.6f) else Color(0xFF2A3848),
                                RoundedCornerShape(12.dp),
                            ),
                        shape = RoundedCornerShape(12.dp),
                        color = if (isSortFiltered) Color(0xFF0F261B) else VibeSurfaceHigh,
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxSize()
                                .padding(horizontal = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.Center,
                        ) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Rounded.Sort,
                                contentDescription = "Фильтр",
                                modifier = Modifier.size(17.dp),
                                tint = if (isSortFiltered) VibeGreen else VibeMuted,
                            )
                            Spacer(Modifier.width(7.dp))
                            Text(
                                text = "Фильтр",
                                color = if (isSortFiltered) VibeGreen else VibeText,
                                fontSize = 13.sp,
                                fontWeight = if (isSortFiltered) FontWeight.SemiBold else FontWeight.Medium,
                                maxLines = 1,
                            )
                            Spacer(Modifier.width(4.dp))
                            Icon(
                                imageVector = Icons.Rounded.ArrowDropDown,
                                contentDescription = null,
                                modifier = Modifier.size(18.dp),
                                tint = if (isSortFiltered) VibeGreen else VibeMuted,
                            )
                        }
                    }

                    DropdownMenu(
                        expanded = showSortMenu,
                        onDismissRequest = { showSortMenu = false },
                        modifier = Modifier
                            .widthIn(min = 210.dp)
                            .background(VibeSurfaceHigh)
                            .border(1.dp, Color(0xFF2E3E50), RoundedCornerShape(12.dp)),
                    ) {
                        TrackSort.values().forEach { sort ->
                            DropdownMenuItem(
                                text = {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        if (currentSort == sort) {
                                            Icon(
                                                imageVector = Icons.Rounded.Check,
                                                contentDescription = null,
                                                tint = VibeGreen,
                                                modifier = Modifier.size(16.dp),
                                            )
                                            Spacer(Modifier.width(8.dp))
                                        } else {
                                            Spacer(Modifier.width(24.dp))
                                        }
                                        Text(
                                            sort.title,
                                            color = if (currentSort == sort) VibeGreen else VibeText,
                                            fontSize = 13.sp,
                                            fontWeight = if (currentSort == sort) FontWeight.SemiBold else FontWeight.Normal,
                                        )
                                    }
                                },
                                onClick = {
                                    currentSort = sort
                                    showSortMenu = false
                                },
                            )
                        }
                    }
                }
            }

            // Active Filter & Sort Status Row
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 4.dp, vertical = 2.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = buildString {
                        append("Сортировка: ")
                        append(currentSort.title)
                        if (isFolderFiltered) {
                            append(" • Папки: ")
                            append(selectedFolders.size)
                        }
                    },
                    color = if (isSortFiltered || isFolderFiltered) VibeGreen.copy(alpha = 0.9f) else VibeMuted,
                    fontSize = 11.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                if (isSortFiltered || isFolderFiltered || searchQuery.isNotEmpty()) {
                    Text(
                        text = "Сбросить",
                        color = VibeGreen,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier
                            .clickable {
                                currentSort = TrackSort.TITLE_ASC
                                searchQuery = ""
                                if (isFolderFiltered) {
                                    scope.launch {
                                        repo?.setSelectedFolders(emptySet())
                                        ServerService.rescan(context)
                                    }
                                }
                            }
                            .padding(start = 8.dp),
                    )
                }
            }

            Spacer(Modifier.height(4.dp))
        }

        if (tracks.isEmpty()) {
            item {
                Card(
                    colors = CardDefaults.cardColors(containerColor = VibeSurface),
                    shape = RoundedCornerShape(16.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 16.dp)
                        .border(1.dp, VibeSurfaceBorder, RoundedCornerShape(16.dp)),
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(28.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Icon(
                            imageVector = Icons.Rounded.MusicNote,
                            contentDescription = null,
                            tint = VibeMuted,
                            modifier = Modifier.size(36.dp),
                        )
                        Spacer(Modifier.height(10.dp))
                        Text(
                            if (searchQuery.isNotBlank()) "По запросу «$searchQuery» ничего не найдено" else "В выбранных папках нет аудиофайлов",
                            color = VibeMuted,
                            fontSize = 14.sp,
                            textAlign = TextAlign.Center,
                        )
                    }
                }
            }
        } else {
            items(tracks, key = { it.id }) { track ->
                TrackItem(
                    track = track,
                    isPlaying = playerState?.currentTrackId == track.id,
                    onClick = {
                        ServerRuntime.sendCommand(
                            RemoteCommandDto(
                                action = "play_track",
                                trackId = track.id,
                                queueIds = tracks.take(150).map { it.id },
                            ),
                        )
                    },
                )
            }
        }

        item {
            Spacer(Modifier.height(36.dp))
        }
    }
}

@Composable
private fun NowPlayingCard(
    player: PlayerStateDto?,
    onNavigateToServer: () -> Unit,
    onNext: () -> Unit,
    onPrev: () -> Unit,
) {
    val coverStore = ServerRuntime.coverStore
    val coverBitmap = remember(player?.currentTrackId, coverStore) {
        loadCoverBitmap(coverStore, player?.currentTrackId)
    }

    val isPlaying = player?.currentTrackId != null && !player.paused

    Card(
        colors = CardDefaults.cardColors(containerColor = VibeSurface),
        shape = RoundedCornerShape(24.dp),
        modifier = Modifier
            .fillMaxWidth()
            .border(
                BorderStroke(
                    1.dp,
                    if (isPlaying) Brush.linearGradient(listOf(VibeGreen.copy(alpha = 0.4f), VibeCyan.copy(alpha = 0.2f), Color(0x11FFFFFF)))
                    else Brush.linearGradient(listOf(VibeSurfaceBorder, VibeSurface)),
                ),
                RoundedCornerShape(24.dp),
            ),
    ) {
        Column(Modifier.padding(18.dp)) {
            if (player?.currentTrackId != null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    // Cover Art with neon rim when playing
                    Box(
                        modifier = Modifier
                            .size(76.dp)
                            .clip(RoundedCornerShape(16.dp))
                            .background(VibeSurfaceHigh)
                            .border(
                                BorderStroke(
                                    1.5.dp,
                                    if (isPlaying) Brush.linearGradient(listOf(VibeGreen, VibeCyan))
                                    else Brush.linearGradient(listOf(VibeSurfaceBorder, VibeSurfaceHigh)),
                                ),
                                RoundedCornerShape(16.dp),
                            ),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (coverBitmap != null) {
                            Image(
                                bitmap = coverBitmap,
                                contentDescription = "Обложка",
                                modifier = Modifier.fillMaxSize(),
                            )
                        } else {
                            Icon(
                                imageVector = Icons.Rounded.MusicNote,
                                contentDescription = "Музыка",
                                tint = if (isPlaying) VibeGreen else VibeMuted,
                                modifier = Modifier.size(34.dp),
                            )
                        }
                    }

                    Spacer(Modifier.width(14.dp))

                    Column(Modifier.weight(1f)) {
                        Text(
                            player.title?.takeIf { it.isNotBlank() } ?: "Без названия",
                            color = VibeText,
                            fontSize = 17.sp,
                            fontWeight = FontWeight.Bold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Spacer(Modifier.height(3.dp))
                        val cleanArtist = remember(player.artist) {
                            val a = player.artist?.trim().orEmpty()
                            if (a.isBlank() || a.equals("<unknown>", ignoreCase = true) || a.equals("unknown", ignoreCase = true)) {
                                "Неизвестный исполнитель"
                            } else {
                                a
                            }
                        }
                        Text(
                            cleanArtist,
                            color = VibeMuted,
                            fontSize = 13.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Spacer(Modifier.height(8.dp))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            // Status Pill Badge with animated equalizer wave
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(if (isPlaying) Color(0x284ADE80) else Color(0x24FBBF24))
                                    .border(1.dp, if (isPlaying) VibeGreen.copy(alpha = 0.45f) else VibeAmber.copy(alpha = 0.45f), RoundedCornerShape(8.dp))
                                    .padding(horizontal = 8.dp, vertical = 3.dp),
                            ) {
                                MiniEqualizerWave(isPlaying = isPlaying, barColor = if (isPlaying) VibeGreen else VibeAmber)
                                Spacer(Modifier.width(6.dp))
                                Text(
                                    if (isPlaying) "Играет на ПК" else "Пауза",
                                    color = if (isPlaying) VibeGreen else VibeAmber,
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.SemiBold,
                                )
                            }
                            if (player.source == "cache") {
                                Spacer(Modifier.width(6.dp))
                                Box(
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(8.dp))
                                        .background(Color(0x2838BDF8))
                                        .border(1.dp, Color(0x4038BDF8), RoundedCornerShape(8.dp))
                                        .padding(horizontal = 8.dp, vertical = 3.dp),
                                ) {
                                    Text("Кэш", color = Color(0xFF38BDF8), fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                                }
                            }
                        }
                    }
                }

                Spacer(Modifier.height(14.dp))

                // Progress Bar
                var isDragging by remember { mutableStateOf(false) }
                var dragValue by remember { mutableFloatStateOf(0f) }
                val currentPos = if (isDragging) dragValue else player.position.toFloat()
                val duration = player.duration.toFloat().coerceAtLeast(1f)

                Column {
                    Slider(
                        value = currentPos.coerceIn(0f, duration),
                        onValueChange = {
                            isDragging = true
                            dragValue = it
                        },
                        onValueChangeFinished = {
                            isDragging = false
                            ServerRuntime.sendCommand(RemoteCommandDto(action = "seek", position = dragValue.toDouble()))
                        },
                        valueRange = 0f..duration,
                        colors = SliderDefaults.colors(
                            thumbColor = VibeGreen,
                            activeTrackColor = VibeGreen,
                            inactiveTrackColor = Color(0xFF1E2A38),
                        ),
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(formatTime(currentPos.toDouble()), color = VibeMuted, fontSize = 11.sp, fontWeight = FontWeight.Medium)
                        Text(formatTime(duration.toDouble()), color = VibeMuted, fontSize = 11.sp, fontWeight = FontWeight.Medium)
                    }
                }

                Spacer(Modifier.height(8.dp))

                // Playback Controls Row (Pure Vector Icons, NO EMOJIS)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceEvenly,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(
                        onClick = onPrev,
                        modifier = Modifier
                            .size(50.dp)
                            .clip(CircleShape)
                            .background(VibeSurfaceHigh)
                            .border(1.dp, Color(0x22FFFFFF), CircleShape),
                    ) {
                        Icon(
                            imageVector = Icons.Rounded.SkipPrevious,
                            contentDescription = "Предыдущий",
                            tint = VibeText,
                            modifier = Modifier.size(26.dp),
                        )
                    }

                    Box(
                        modifier = Modifier
                            .size(66.dp)
                            .clip(CircleShape)
                            .background(Brush.linearGradient(listOf(VibeGreen, VibeCyan)))
                            .border(1.5.dp, Color(0x44FFFFFF), CircleShape)
                            .clickable {
                                ServerRuntime.sendCommand(RemoteCommandDto(action = "toggle"))
                            },
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            imageVector = if (player.paused) Icons.Rounded.PlayArrow else Icons.Rounded.Pause,
                            contentDescription = if (player.paused) "Воспроизведение" else "Пауза",
                            tint = Color(0xFF06210F),
                            modifier = Modifier.size(34.dp),
                        )
                    }

                    IconButton(
                        onClick = onNext,
                        modifier = Modifier
                            .size(50.dp)
                            .clip(CircleShape)
                            .background(VibeSurfaceHigh)
                            .border(1.dp, Color(0x22FFFFFF), CircleShape),
                    ) {
                        Icon(
                            imageVector = Icons.Rounded.SkipNext,
                            contentDescription = "Следующий",
                            tint = VibeText,
                            modifier = Modifier.size(26.dp),
                        )
                    }
                }

                Spacer(Modifier.height(14.dp))
                HorizontalDivider(color = VibeSurfaceBorder)
                Spacer(Modifier.height(12.dp))

                // Volume Slider (Vector Icons, NO EMOJIS)
                var volumeValue by remember(player.volume) { mutableFloatStateOf(player.volume.toFloat()) }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(
                        onClick = {
                            val newVol = if (volumeValue > 0) 0.0 else 80.0
                            volumeValue = newVol.toFloat()
                            ServerRuntime.sendCommand(RemoteCommandDto(action = "volume", volume = newVol))
                        },
                        modifier = Modifier.size(34.dp),
                    ) {
                        Icon(
                            imageVector = if (volumeValue <= 0) Icons.AutoMirrored.Rounded.VolumeMute else Icons.AutoMirrored.Rounded.VolumeUp,
                            contentDescription = "Громкость",
                            tint = if (volumeValue <= 0) VibeRed else VibeMuted,
                            modifier = Modifier.size(20.dp),
                        )
                    }
                    Spacer(Modifier.width(6.dp))
                    Slider(
                        value = volumeValue.coerceIn(0f, 100f),
                        onValueChange = {
                            volumeValue = it
                            ServerRuntime.sendCommand(RemoteCommandDto(action = "volume", volume = it.toDouble()))
                        },
                        valueRange = 0f..100f,
                        modifier = Modifier.weight(1f),
                        colors = SliderDefaults.colors(
                            thumbColor = VibeGreen,
                            activeTrackColor = VibeGreen,
                            inactiveTrackColor = VibeSurfaceBorder,
                        ),
                    )
                    Spacer(Modifier.width(8.dp))
                    Surface(
                        color = VibeSurfaceHigh,
                        shape = RoundedCornerShape(8.dp),
                        border = BorderStroke(1.dp, VibeSurfaceBorder),
                    ) {
                        Text(
                            "${volumeValue.toInt()}%",
                            color = VibeText,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.padding(horizontal = 7.dp, vertical = 3.dp),
                        )
                    }
                }
            } else {
                // Waiting / Empty State
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Box(
                        modifier = Modifier
                            .size(60.dp)
                            .clip(CircleShape)
                            .background(VibeSurfaceHigh)
                            .border(1.dp, Color(0xFF223143), CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            imageVector = Icons.Rounded.Headphones,
                            contentDescription = null,
                            tint = VibeGreen,
                            modifier = Modifier.size(30.dp),
                        )
                    }
                    Spacer(Modifier.height(12.dp))
                    Text(
                        "Компьютер в режиме ожидания",
                        color = VibeText,
                        fontSize = 17.sp,
                        fontWeight = FontWeight.Bold,
                    )
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "Подключите ПК к телефону по Wi-Fi или нажмите на любой трек из списка ниже, чтобы запустить воспроизведение на ПК.",
                        color = VibeMuted,
                        fontSize = 13.sp,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(horizontal = 12.dp),
                    )
                    Spacer(Modifier.height(14.dp))
                    OutlinedButton(
                        onClick = onNavigateToServer,
                        shape = RoundedCornerShape(12.dp),
                        border = BorderStroke(1.dp, Color(0xFF223143)),
                    ) {
                        Icon(
                            imageVector = Icons.Rounded.Sensors,
                            contentDescription = null,
                            tint = VibeGreen,
                            modifier = Modifier.size(16.dp),
                        )
                        Spacer(Modifier.width(8.dp))
                        Text("Показать адрес сервера и токен", color = VibeGreen, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                    }
                }
            }
        }
    }
}

@Composable
private fun TrackItem(
    track: TrackDto,
    isPlaying: Boolean,
    onClick: () -> Unit,
) {
    val cleanArtist = remember(track.artist) {
        val a = track.artist.trim()
        if (a.isBlank() || a.equals("<unknown>", ignoreCase = true) || a.equals("unknown", ignoreCase = true)) {
            "Неизвестный исполнитель"
        } else {
            a
        }
    }

    Card(
        colors = CardDefaults.cardColors(
            containerColor = if (isPlaying) VibeGreen.copy(alpha = 0.12f) else VibeSurface,
        ),
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 3.5.dp)
            .border(
                BorderStroke(
                    1.dp,
                    if (isPlaying) VibeGreen.copy(alpha = 0.7f) else VibeSurfaceBorder,
                ),
                RoundedCornerShape(16.dp),
            )
            .clickable(onClick = onClick),
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(if (isPlaying) VibeGreen.copy(alpha = 0.2f) else VibeSurfaceHigh)
                    .border(
                        1.dp,
                        if (isPlaying) VibeGreen.copy(alpha = 0.4f) else VibeSurfaceBorder,
                        RoundedCornerShape(12.dp),
                    ),
                contentAlignment = Alignment.Center,
            ) {
                if (isPlaying) {
                    MiniEqualizerWave(isPlaying = true, barColor = VibeGreen)
                } else {
                    Icon(
                        imageVector = Icons.Rounded.MusicNote,
                        contentDescription = null,
                        tint = VibeMuted,
                        modifier = Modifier.size(20.dp),
                    )
                }
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    track.title.ifBlank { "Без названия" },
                    color = if (isPlaying) VibeGreen else VibeText,
                    fontSize = 15.sp,
                    fontWeight = if (isPlaying) FontWeight.Bold else FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(3.dp))
                Text(
                    cleanArtist,
                    color = if (isPlaying) VibeGreen.copy(alpha = 0.8f) else VibeMuted,
                    fontSize = 12.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Spacer(Modifier.width(10.dp))
            Surface(
                color = if (isPlaying) VibeGreen.copy(alpha = 0.18f) else VibeSurfaceHigh,
                shape = RoundedCornerShape(8.dp),
                border = BorderStroke(1.dp, if (isPlaying) VibeGreen.copy(alpha = 0.3f) else VibeSurfaceBorder),
            ) {
                Text(
                    formatTime(track.durationMs / 1000.0),
                    color = if (isPlaying) VibeGreen else VibeMuted,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                )
            }
        }
    }
}

/** Диалог выбора папок для загрузки музыки. */
@Composable
private fun FolderSelectionDialog(
    repo: com.vibecast.app.data.CatalogRepository,
    onDismiss: () -> Unit,
    onApply: (Set<String>) -> Unit,
) {
    var availableFolders by remember { mutableStateOf<List<FolderInfo>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    val initialSelected = remember { repo.getSelectedFolders() }
    val selected = remember { mutableStateListOf<String>().apply { addAll(initialSelected) } }

    LaunchedEffect(Unit) {
        availableFolders = repo.getAvailableFolders()
        loading = false
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = VibeSurface,
        shape = RoundedCornerShape(22.dp),
        title = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Rounded.FolderOpen,
                    contentDescription = null,
                    tint = VibeGreen,
                    modifier = Modifier.size(24.dp),
                )
                Spacer(Modifier.width(10.dp))
                Text("Папки с музыкой", color = VibeText, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            }
        },
        text = {
            Column(modifier = Modifier.fillMaxWidth()) {
                Text(
                    "Выберите папки, из которых VibeCast будет загружать аудиофайлы. Если ни одна не выбрана — сканируются все папки.",
                    color = VibeMuted,
                    fontSize = 12.sp,
                )
                Spacer(Modifier.height(12.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    TextButton(
                        onClick = {
                            selected.clear()
                            selected.addAll(availableFolders.map { it.path })
                        },
                    ) {
                        Text("Выбрать все", color = VibeGreen, fontSize = 12.sp)
                    }

                    TextButton(
                        onClick = { selected.clear() },
                    ) {
                        Text("Снять все (все папки)", color = VibeMuted, fontSize = 12.sp)
                    }
                }

                HorizontalDivider(color = VibeSurfaceBorder, modifier = Modifier.padding(vertical = 6.dp))

                if (loading) {
                    Box(modifier = Modifier.fillMaxWidth().height(140.dp), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(color = VibeGreen, modifier = Modifier.size(32.dp))
                    }
                } else if (availableFolders.isEmpty()) {
                    Box(modifier = Modifier.fillMaxWidth().padding(vertical = 20.dp), contentAlignment = Alignment.Center) {
                        Text("Папки с аудиофайлами не найдены", color = VibeMuted, fontSize = 13.sp)
                    }
                } else {
                    LazyColumn(modifier = Modifier.heightIn(max = 280.dp)) {
                        items(availableFolders) { folder ->
                            val isChecked = selected.contains(folder.path) || selected.contains(folder.name)
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(10.dp))
                                    .clickable {
                                        if (isChecked) {
                                            selected.remove(folder.path)
                                            selected.remove(folder.name)
                                        } else {
                                            selected.add(folder.path)
                                        }
                                    }
                                    .padding(vertical = 6.dp, horizontal = 4.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Checkbox(
                                    checked = isChecked,
                                    onCheckedChange = { checked ->
                                        if (checked) {
                                            selected.add(folder.path)
                                        } else {
                                            selected.remove(folder.path)
                                            selected.remove(folder.name)
                                        }
                                    },
                                    colors = CheckboxDefaults.colors(
                                        checkedColor = VibeGreen,
                                        checkmarkColor = Color(0xFF06210F),
                                        uncheckedColor = VibeMuted,
                                    ),
                                )
                                Spacer(Modifier.width(8.dp))
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        folder.name,
                                        color = VibeText,
                                        fontSize = 14.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                    Text(
                                        "${folder.count} треков",
                                        color = VibeMuted,
                                        fontSize = 11.sp,
                                    )
                                }
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            Button(
                onClick = { onApply(selected.toSet()) },
                colors = ButtonDefaults.buttonColors(containerColor = VibeGreen),
                shape = RoundedCornerShape(10.dp),
            ) {
                Text("Применить", color = Color(0xFF06210F), fontWeight = FontWeight.Bold)
            }
        },
        dismissButton = {
            OutlinedButton(
                onClick = onDismiss,
                shape = RoundedCornerShape(10.dp),
            ) {
                Text("Отмена", color = VibeText)
            }
        },
    )
}

@Composable
private fun ThemeItemView(
    theme: VibeTheme,
    isSelected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = theme.bgCard),
        shape = RoundedCornerShape(14.dp),
        border = BorderStroke(
            if (isSelected) 2.dp else 1.dp,
            if (isSelected) theme.accent else theme.border,
        ),
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .clickable(onClick = onClick),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.weight(1f),
            ) {
                // Swatches preview
                Row(
                    horizontalArrangement = Arrangement.spacedBy((-6).dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        modifier = Modifier
                            .size(24.dp)
                            .clip(CircleShape)
                            .background(theme.bgPrimary)
                            .border(1.dp, theme.border, CircleShape),
                    )
                    Box(
                        modifier = Modifier
                            .size(24.dp)
                            .clip(CircleShape)
                            .background(theme.accent)
                            .border(1.dp, Color(0x33FFFFFF), CircleShape),
                    )
                    Box(
                        modifier = Modifier
                            .size(24.dp)
                            .clip(CircleShape)
                            .background(theme.accentHover)
                            .border(1.dp, Color(0x33FFFFFF), CircleShape),
                    )
                }
                Spacer(Modifier.width(14.dp))
                Column {
                    Text(
                        text = theme.name,
                        color = theme.textMain,
                        fontSize = 14.sp,
                        fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
                    )
                    Text(
                        text = theme.id.replaceFirstChar { it.uppercase() },
                        color = theme.textMuted,
                        fontSize = 11.sp,
                    )
                }
            }

            if (isSelected) {
                Box(
                    modifier = Modifier
                        .size(24.dp)
                        .clip(CircleShape)
                        .background(theme.accent),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = Icons.Rounded.Check,
                        contentDescription = "Выбрано",
                        tint = theme.bgPrimary,
                        modifier = Modifier.size(15.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun ThemeSelectionCard() {
    val context = LocalContext.current
    val currentTheme = ThemePreferences.currentTheme

    Card(
        colors = CardDefaults.cardColors(containerColor = VibeSurface),
        shape = RoundedCornerShape(22.dp),
        modifier = Modifier
            .fillMaxWidth()
            .border(1.dp, VibeSurfaceBorder, RoundedCornerShape(22.dp)),
    ) {
        Column(Modifier.padding(20.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(38.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(Brush.linearGradient(listOf(VibeGreen, VibeCyan))),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = Icons.Rounded.Palette,
                        contentDescription = null,
                        tint = Color(0xFF06210F),
                        modifier = Modifier.size(20.dp),
                    )
                }
                Spacer(Modifier.width(12.dp))
                Column {
                    Text(
                        "Тема оформления",
                        color = VibeText,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 17.sp,
                    )
                    Text(
                        "11 тем, как на ПК (сейчас: ${currentTheme.name})",
                        color = VibeMuted,
                        fontSize = 12.sp,
                    )
                }
            }

            Spacer(Modifier.height(16.dp))

            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                VibeThemes.allThemes.forEach { theme ->
                    ThemeItemView(
                        theme = theme,
                        isSelected = theme.id == currentTheme.id,
                        onClick = {
                            ThemePreferences.setTheme(context, theme)
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun ThemeSelectionDialog(onDismiss: () -> Unit) {
    val context = LocalContext.current
    val currentTheme = ThemePreferences.currentTheme

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = VibeSurface,
        shape = RoundedCornerShape(22.dp),
        title = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Rounded.Palette,
                    contentDescription = null,
                    tint = VibeGreen,
                    modifier = Modifier.size(24.dp),
                )
                Spacer(Modifier.width(10.dp))
                Text("Тема оформления", color = VibeText, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            }
        },
        text = {
            Column(modifier = Modifier.fillMaxWidth()) {
                Text(
                    "Выберите тему интерфейса. Оформление идентично темам на ПК.",
                    color = VibeMuted,
                    fontSize = 12.sp,
                )
                Spacer(Modifier.height(12.dp))
                LazyColumn(
                    modifier = Modifier.heightIn(max = 380.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(VibeThemes.allThemes) { theme ->
                        ThemeItemView(
                            theme = theme,
                            isSelected = theme.id == currentTheme.id,
                            onClick = {
                                ThemePreferences.setTheme(context, theme)
                            },
                        )
                    }
                }
            }
        },
        confirmButton = {
            Button(
                onClick = onDismiss,
                colors = ButtonDefaults.buttonColors(containerColor = VibeGreen),
                shape = RoundedCornerShape(10.dp),
            ) {
                Text("Готово", color = Color(0xFF06210F), fontWeight = FontWeight.Bold)
            }
        },
    )
}

@Composable
private fun ShareAndUpdatesScreen() {
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val coroutineScope = rememberCoroutineScope()

    var copied by remember { mutableStateOf(false) }
    var checkingUpdate by remember { mutableStateOf(false) }
    var updateResult by remember { mutableStateOf<AppUpdateInfo?>(null) }
    var updateError by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(copied) {
        if (copied) {
            delay(2000)
            copied = false
        }
    }

    val qrBitmap = remember {
        QrCodeGenerator.generate(UpdateManager.GITHUB_REPO_URL, 600)
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(Brush.linearGradient(listOf(VibeGreen, VibeCyan))),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = Icons.Rounded.Palette,
                    contentDescription = null,
                    tint = Color(0xFF06210F),
                    modifier = Modifier.size(22.dp),
                )
            }
            Spacer(Modifier.width(12.dp))
            Column {
                Text("Оформление и инфо", color = VibeText, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                Text("Темы интерфейса, QR-код и обновления", color = VibeMuted, fontSize = 12.sp)
            }
        }

        Spacer(Modifier.height(20.dp))

        // Themes Card
        ThemeSelectionCard()

        Spacer(Modifier.height(18.dp))

        // QR Code Card
        Card(
            colors = CardDefaults.cardColors(containerColor = VibeSurface),
            shape = RoundedCornerShape(22.dp),
            modifier = Modifier
                .fillMaxWidth()
                .border(1.dp, VibeSurfaceBorder, RoundedCornerShape(22.dp)),
        ) {
            Column(
                modifier = Modifier.padding(22.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    "Отсканируйте камерой телефона",
                    color = VibeText,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 16.sp,
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    "Чтобы открыть репозиторий проекта на GitHub и установить VibeCast на ПК или телефон.",
                    color = VibeMuted,
                    fontSize = 13.sp,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(18.dp))

                // QR Container with white padding
                Box(
                    modifier = Modifier
                        .size(230.dp)
                        .clip(RoundedCornerShape(18.dp))
                        .background(Color.White)
                        .padding(14.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    if (qrBitmap != null) {
                        Image(
                            bitmap = qrBitmap,
                            contentDescription = "QR Code на GitHub",
                            modifier = Modifier.fillMaxSize(),
                        )
                    } else {
                        Text("Ошибка генерации QR", color = Color.Black, fontSize = 12.sp)
                    }
                }

                Spacer(Modifier.height(16.dp))
                Text(
                    UpdateManager.GITHUB_REPO_URL,
                    color = VibeGreen,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                    textAlign = TextAlign.Center,
                )

                Spacer(Modifier.height(18.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Button(
                        onClick = {
                            clipboard.setText(AnnotatedString(UpdateManager.GITHUB_REPO_URL))
                            copied = true
                        },
                        modifier = Modifier.weight(1f).height(46.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = VibeSurfaceHigh),
                        shape = RoundedCornerShape(12.dp),
                    ) {
                        Icon(
                            imageVector = if (copied) Icons.Rounded.Check else Icons.Rounded.ContentCopy,
                            contentDescription = null,
                            tint = if (copied) VibeGreen else VibeText,
                            modifier = Modifier.size(16.dp),
                        )
                        Spacer(Modifier.width(6.dp))
                        Text(if (copied) "Скопировано!" else "Копировать", color = VibeText, fontSize = 13.sp)
                    }

                    Button(
                        onClick = {
                            val sendIntent = Intent().apply {
                                action = Intent.ACTION_SEND
                                putExtra(
                                    Intent.EXTRA_TEXT,
                                    "Слушай музыку с телефона на компьютере по Wi-Fi с помощью VibeCast! Репозиторий и загрузка: ${UpdateManager.GITHUB_REPO_URL}",
                                )
                                type = "text/plain"
                            }
                            context.startActivity(Intent.createChooser(sendIntent, "Поделиться VibeCast"))
                        },
                        modifier = Modifier.weight(1f).height(46.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = VibeGreen),
                        shape = RoundedCornerShape(12.dp),
                    ) {
                        Icon(
                            imageVector = Icons.Rounded.Share,
                            contentDescription = null,
                            tint = Color(0xFF06210F),
                            modifier = Modifier.size(16.dp),
                        )
                        Spacer(Modifier.width(6.dp))
                        Text("Поделиться", color = Color(0xFF06210F), fontWeight = FontWeight.Bold, fontSize = 13.sp)
                    }
                }
            }
        }

        Spacer(Modifier.height(18.dp))

        // Updates Card
        Card(
            colors = CardDefaults.cardColors(containerColor = VibeSurface),
            shape = RoundedCornerShape(22.dp),
            modifier = Modifier
                .fillMaxWidth()
                .border(1.dp, VibeSurfaceBorder, RoundedCornerShape(22.dp)),
        ) {
            Column(Modifier.padding(20.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = Icons.Rounded.Update,
                        contentDescription = null,
                        tint = VibeGreen,
                        modifier = Modifier.size(24.dp),
                    )
                    Spacer(Modifier.width(10.dp))
                    Column {
                        Text("Обновления приложения", color = VibeText, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                        Text("Текущая версия: v${BuildConfig.VERSION_NAME}", color = VibeMuted, fontSize = 12.sp)
                    }
                }

                Spacer(Modifier.height(14.dp))

                Button(
                    onClick = {
                        checkingUpdate = true
                        updateError = null
                        coroutineScope.launch {
                            val res = UpdateManager.checkForUpdates()
                            checkingUpdate = false
                            res.onSuccess { updateResult = it }
                                .onFailure { updateError = it.message ?: "Ошибка проверки" }
                        }
                    },
                    enabled = !checkingUpdate,
                    modifier = Modifier.fillMaxWidth().height(46.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = VibeSurfaceHigh),
                    shape = RoundedCornerShape(12.dp),
                ) {
                    if (checkingUpdate) {
                        CircularProgressIndicator(color = VibeGreen, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(10.dp))
                        Text("Проверяю обновления…", color = VibeGreen, fontSize = 13.sp)
                    } else {
                        Icon(
                            imageVector = Icons.Rounded.Refresh,
                            contentDescription = null,
                            tint = VibeGreen,
                            modifier = Modifier.size(18.dp),
                        )
                        Spacer(Modifier.width(8.dp))
                        Text("Проверить обновления", color = VibeGreen, fontWeight = FontWeight.Medium, fontSize = 13.sp)
                    }
                }

                if (updateError != null) {
                    Spacer(Modifier.height(10.dp))
                    Banner(text = updateError.orEmpty(), color = VibeRed)
                }

                if (updateResult != null) {
                    val res = updateResult!!
                    Spacer(Modifier.height(12.dp))
                    if (res.hasUpdate) {
                        Card(
                            colors = CardDefaults.cardColors(containerColor = VibeSurfaceHigh),
                            shape = RoundedCornerShape(14.dp),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Column(Modifier.padding(14.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Icon(
                                        imageVector = Icons.Rounded.SystemUpdate,
                                        contentDescription = null,
                                        tint = VibeGreen,
                                        modifier = Modifier.size(20.dp),
                                    )
                                    Spacer(Modifier.width(8.dp))
                                    Text(
                                        "Доступна новая версия: v${res.latestVersion}!",
                                        color = VibeGreen,
                                        fontWeight = FontWeight.Bold,
                                        fontSize = 15.sp,
                                    )
                                }
                                if (!res.releaseNotes.isNullOrBlank()) {
                                    Spacer(Modifier.height(6.dp))
                                    Text(
                                        res.releaseNotes,
                                        color = VibeMuted,
                                        fontSize = 12.sp,
                                    )
                                }
                                Spacer(Modifier.height(12.dp))
                                Button(
                                    onClick = {
                                        val apkTarget = res.apkDownloadUrl ?: res.releaseUrl
                                        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(apkTarget)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                                        context.startActivity(intent)
                                    },
                                    modifier = Modifier.fillMaxWidth().height(44.dp),
                                    colors = ButtonDefaults.buttonColors(containerColor = VibeGreen),
                                    shape = RoundedCornerShape(10.dp),
                                ) {
                                    Text("Скачать обновление (APK)", color = Color(0xFF06210F), fontWeight = FontWeight.Bold)
                                }
                            }
                        }
                    } else {
                        Banner(
                            text = "У вас установлена последняя версия VibeCast (v${BuildConfig.VERSION_NAME}).",
                            color = VibeGreen,
                        )
                    }
                }
            }
        }

        Spacer(Modifier.height(30.dp))
    }
}

private fun formatTime(seconds: Double): String {
    val total = seconds.toLong().coerceAtLeast(0)
    val mins = total / 60
    val secs = total % 60
    return "%02d:%02d".format(mins, secs)
}

private fun loadCoverBitmap(coverStore: CoverStore?, trackId: String?): ImageBitmap? {
    if (coverStore == null || trackId == null) return null
    val data = coverStore.cover(trackId) ?: return null
    return runCatching {
        android.graphics.BitmapFactory.decodeByteArray(data.bytes, 0, data.bytes.size)?.asImageBitmap()
    }.getOrNull()
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
                .background(Brush.linearGradient(listOf(VibeGreen, VibeCyan))),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = Icons.Rounded.Headphones,
                contentDescription = null,
                tint = Color(0xFF06210F),
                modifier = Modifier.size(46.dp),
            )
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
            modifier = Modifier.fillMaxWidth().border(1.dp, VibeSurfaceBorder, RoundedCornerShape(24.dp)),
        ) {
            Column(Modifier.padding(22.dp)) {
                Text("Нужен доступ к аудио", color = VibeText, fontWeight = FontWeight.SemiBold, fontSize = 18.sp)
                Spacer(Modifier.height(10.dp))
                Text(
                    "VibeCast читает локальные аудиофайлы через MediaStore, чтобы воспроизводить их на ПК. " +
                        "Файлы не загружаются в интернет — передача идёт только по вашему Wi-Fi.",
                    color = VibeMuted,
                    fontSize = 14.sp,
                )
                Spacer(Modifier.height(14.dp))
                Bullet("Доступ к аудиотеке устройства")
                if (Build.VERSION.SDK_INT >= 33) Bullet("Уведомления для отображения статуса раздачи")
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
            "Совет: телефон и ПК должны быть подключены к одной Wi-Fi сети.",
            color = VibeMuted,
            fontSize = 13.sp,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun Bullet(text: String) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 4.dp)) {
        Icon(
            imageVector = Icons.Rounded.CheckCircle,
            contentDescription = null,
            tint = VibeGreen,
            modifier = Modifier.size(16.dp),
        )
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

    var showThemeDialog by remember { mutableStateOf(false) }

    if (showThemeDialog) {
        ThemeSelectionDialog(onDismiss = { showThemeDialog = false })
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 24.dp),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Box(
                modifier = Modifier
                    .size(42.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(Brush.linearGradient(listOf(VibeGreen, VibeCyan))),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = Icons.Rounded.Sensors,
                    contentDescription = null,
                    tint = Color(0xFF06210F),
                    modifier = Modifier.size(24.dp),
                )
            }
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text("VibeCast Сервер", color = VibeText, fontSize = 21.sp, fontWeight = FontWeight.Bold)
                Text("Раздача медиатеки для приложения на ПК", color = VibeMuted, fontSize = 12.sp)
            }
            Spacer(Modifier.width(8.dp))
            IconButton(
                onClick = { showThemeDialog = true },
                modifier = Modifier
                    .size(40.dp)
                    .clip(CircleShape)
                    .background(VibeSurfaceHigh)
                    .border(1.dp, VibeSurfaceBorder, CircleShape),
            ) {
                Icon(
                    imageVector = Icons.Rounded.Palette,
                    contentDescription = "Темы оформления",
                    tint = VibeGreen,
                    modifier = Modifier.size(20.dp),
                )
            }
        }

        Spacer(Modifier.height(20.dp))
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


        Spacer(Modifier.height(16.dp))
        Card(
            colors = CardDefaults.cardColors(containerColor = VibeSurface),
            shape = RoundedCornerShape(20.dp),
            modifier = Modifier.fillMaxWidth().border(1.dp, VibeSurfaceBorder, RoundedCornerShape(20.dp)),
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
                        Icon(
                            imageVector = Icons.Rounded.Refresh,
                            contentDescription = null,
                            tint = VibeText,
                            modifier = Modifier.size(16.dp),
                        )
                        Spacer(Modifier.width(6.dp))
                        Text(
                            if (state.scanning) "Сканирую…" else "Обновить",
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
                    Icon(
                        imageVector = Icons.Rounded.BatteryChargingFull,
                        contentDescription = null,
                        tint = VibeText,
                        modifier = Modifier.size(18.dp),
                    )
                    Spacer(Modifier.width(8.dp))
                    Text("Разрешить работу в фоне", color = VibeText)
                }
                Spacer(Modifier.height(8.dp))
                Text(
                    "Отключите оптимизацию батареи для VibeCast, чтобы сервер не усыплялся при выключенном экране телефона.",
                    color = VibeMuted,
                    fontSize = 12.sp,
                )
            }
        }

        Spacer(Modifier.height(16.dp))
        Card(
            colors = CardDefaults.cardColors(containerColor = VibeSurface),
            shape = RoundedCornerShape(20.dp),
            modifier = Modifier.fillMaxWidth().border(1.dp, VibeSurfaceBorder, RoundedCornerShape(20.dp)),
        ) {
            Column(Modifier.padding(18.dp)) {
                Text("Статус фоновой работы", color = VibeText, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(6.dp))
                Text(
                    "Сервер работает в Foreground Service с блокировкой сна (WakeLock & WifiLock). " +
                        "Уведомление «VibeCast раздаёт библиотеку» должно оставаться в системной шторке.",
                    color = VibeMuted,
                    fontSize = 12.sp,
                )
            }
        }

        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun StatusCard(state: ServerRuntime.State) {
    val repo = ServerRuntime.repository
    val selectedFoldersCount = remember(state.version) {
        repo?.getSelectedFolders()?.size ?: 0
    }

    val isOnline = state.running
    val title = when {
        state.error != null -> "Сервер не запущен"
        state.scanning -> "Сканирование медиатеки…"
        state.starting -> "Запуск сервера…"
        state.running -> "Сервер активен"
        else -> "Сервер остановлен"
    }

    Card(
        colors = CardDefaults.cardColors(containerColor = VibeSurface),
        shape = RoundedCornerShape(24.dp),
        modifier = Modifier
            .fillMaxWidth()
            .border(
                BorderStroke(
                    1.dp,
                    if (isOnline) Brush.linearGradient(listOf(VibeGreen.copy(alpha = 0.4f), VibeCyan.copy(alpha = 0.2f), Color(0x11FFFFFF)))
                    else Brush.linearGradient(listOf(VibeSurfaceBorder, VibeSurface)),
                ),
                RoundedCornerShape(24.dp),
            ),
    ) {
        Column(Modifier.padding(20.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                ServerLivePulse(isActive = state.running)
                Spacer(Modifier.width(10.dp))
                Text(title, color = VibeText, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                Spacer(Modifier.weight(1f))
                if (state.running) {
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .background(VibeGreen.copy(alpha = 0.16f))
                            .border(1.dp, VibeGreen.copy(alpha = 0.4f), RoundedCornerShape(8.dp))
                            .padding(horizontal = 8.dp, vertical = 3.dp),
                    ) {
                        Text("ONLINE", color = VibeGreen, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }
            Spacer(Modifier.height(18.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                MetricTile(
                    label = "Адрес подключения",
                    value = if (state.running && state.ip != null) "${state.ip}:${state.port}" else "—",
                    icon = Icons.Rounded.Sensors,
                    modifier = Modifier.weight(1f),
                )
                MetricTile(
                    label = "Каталог",
                    value = if (state.version > 0) "#${state.version}" else "—",
                    icon = Icons.Rounded.Update,
                    modifier = Modifier.weight(1f),
                )
            }
            Spacer(Modifier.height(12.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                MetricTile(
                    label = "Всего треков",
                    value = if (state.trackCount > 0) "${state.trackCount}" else "0",
                    icon = Icons.Rounded.MusicNote,
                    modifier = Modifier.weight(1f),
                )
                MetricTile(
                    label = "Выбранные папки",
                    value = if (selectedFoldersCount > 0) "$selectedFoldersCount выбрано" else "Все папки",
                    icon = Icons.Rounded.FolderOpen,
                    modifier = Modifier.weight(1f),
                )
            }
            if (state.token.isNotBlank()) {
                Spacer(Modifier.height(18.dp))
                TokenCard(state.token)
            }
        }
    }
}

@Composable
private fun MetricTile(
    label: String,
    value: String,
    icon: ImageVector,
    modifier: Modifier = Modifier,
) {
    Surface(
        color = VibeSurfaceHigh,
        shape = RoundedCornerShape(14.dp),
        border = BorderStroke(1.dp, VibeSurfaceBorder),
        modifier = modifier,
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = VibeMuted,
                    modifier = Modifier.size(14.dp),
                )
                Spacer(Modifier.width(6.dp))
                Text(label, color = VibeMuted, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Spacer(Modifier.height(6.dp))
            Text(
                value,
                color = VibeText,
                fontSize = 15.sp,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun TokenCard(token: String) {
    var revealed by remember { mutableStateOf(false) }
    var copied by remember { mutableStateOf(false) }
    val clipboard = LocalClipboardManager.current

    LaunchedEffect(copied) {
        if (copied) {
            delay(2000)
            copied = false
        }
    }

    Surface(
        color = VibeSurfaceHigh,
        shape = RoundedCornerShape(14.dp),
        border = BorderStroke(1.dp, VibeSurfaceBorder),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Bearer-токен авторизации", color = VibeMuted, fontSize = 11.sp, fontWeight = FontWeight.Medium)
                Spacer(Modifier.weight(1f))
                if (copied) {
                    Text("Скопировано!", color = VibeGreen, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                }
            }
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = if (revealed) token else "••••••••••••••••••••••••••",
                    color = VibeText,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(8.dp))
                Button(
                    onClick = { revealed = !revealed },
                    colors = ButtonDefaults.buttonColors(containerColor = VibeSurface),
                    shape = RoundedCornerShape(8.dp),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 10.dp, vertical = 4.dp),
                    modifier = Modifier.height(32.dp),
                ) {
                    Text(if (revealed) "Скрыть" else "Показать", color = VibeText, fontSize = 11.sp)
                }
                Spacer(Modifier.width(6.dp))
                Button(
                    onClick = {
                        clipboard.setText(AnnotatedString(token))
                        copied = true
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = if (copied) VibeGreen.copy(alpha = 0.25f) else VibeSurface),
                    shape = RoundedCornerShape(8.dp),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 10.dp, vertical = 4.dp),
                    modifier = Modifier.height(32.dp),
                ) {
                    Icon(
                        imageVector = if (copied) Icons.Rounded.Check else Icons.Rounded.ContentCopy,
                        contentDescription = null,
                        tint = if (copied) VibeGreen else VibeText,
                        modifier = Modifier.size(14.dp),
                    )
                    Spacer(Modifier.width(4.dp))
                    Text(if (copied) "Готово" else "Копия", color = if (copied) VibeGreen else VibeText, fontSize = 11.sp)
                }
            }
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
    }
}
