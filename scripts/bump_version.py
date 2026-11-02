#!/usr/bin/env python3
"""Bump VibeCast version across Android and Desktop configuration files."""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

def bump_version(new_version: str, version_code: int = None) -> None:
    clean_version = new_version.lstrip("v").strip()
    parts = clean_version.split(".")
    if len(parts) < 2:
        print(f"Error: invalid version string '{new_version}', expected e.g. 0.2.0")
        sys.exit(1)

    # 1. Android build.gradle.kts
    android_gradle = ROOT / "android" / "app" / "build.gradle.kts"
    if android_gradle.exists():
        content = android_gradle.read_text(encoding="utf-8")
        if version_code is None:
            # Auto-increment versionCode if not provided
            code_match = re.search(r"versionCode\s*=\s*(\d+)", content)
            current_code = int(code_match.group(1)) if code_match else 1
            version_code = current_code + 1

        content = re.sub(r'versionCode\s*=\s*\d+', f'versionCode = {version_code}', content)
        content = re.sub(r'versionName\s*=\s*"[^"]+"', f'versionName = "{clean_version}"', content)
        android_gradle.write_text(content, encoding="utf-8")
        print(f"Updated {android_gradle.relative_to(ROOT)} -> v{clean_version} (code {version_code})")

    # 2. Android Shared build.gradle.kts
    shared_gradle = ROOT / "android" / "shared" / "build.gradle.kts"
    if shared_gradle.exists():
        content = shared_gradle.read_text(encoding="utf-8")
        content = re.sub(r'version\s*=\s*"[^"]+"', f'version = "{clean_version}"', content)
        shared_gradle.write_text(content, encoding="utf-8")
        print(f"Updated {shared_gradle.relative_to(ROOT)} -> v{clean_version}")

    # 3. Android Shared VibeCastServer.kt default
    server_kt = ROOT / "android" / "shared" / "src" / "main" / "kotlin" / "com" / "vibecast" / "shared" / "server" / "VibeCastServer.kt"
    if server_kt.exists():
        content = server_kt.read_text(encoding="utf-8")
        content = re.sub(r'val appVersion:\s*String\s*=\s*"[^"]+"', f'val appVersion: String = "{clean_version}"', content)
        server_kt.write_text(content, encoding="utf-8")
        print(f"Updated {server_kt.relative_to(ROOT)} -> v{clean_version}")

    # 4. Desktop Cargo.toml
    cargo_toml = ROOT / "desktop" / "src-tauri" / "Cargo.toml"
    if cargo_toml.exists():
        content = cargo_toml.read_text(encoding="utf-8")
        content = re.sub(r'(?m)^version\s*=\s*"[^"]+"', f'version = "{clean_version}"', content, count=1)
        cargo_toml.write_text(content, encoding="utf-8")
        print(f"Updated {cargo_toml.relative_to(ROOT)} -> v{clean_version}")

    # 5. Desktop tauri.conf.json
    tauri_conf = ROOT / "desktop" / "src-tauri" / "tauri.conf.json"
    if tauri_conf.exists():
        content = tauri_conf.read_text(encoding="utf-8")
        content = re.sub(r'"version":\s*"[^"]+"', f'"version": "{clean_version}"', content)
        tauri_conf.write_text(content, encoding="utf-8")
        print(f"Updated {tauri_conf.relative_to(ROOT)} -> v{clean_version}")

    # 6. Desktop package.json
    pkg_json = ROOT / "desktop" / "package.json"
    if pkg_json.exists():
        content = pkg_json.read_text(encoding="utf-8")
        content = re.sub(r'"version":\s*"[^"]+"', f'"version": "{clean_version}"', content)
        pkg_json.write_text(content, encoding="utf-8")
        print(f"Updated {pkg_json.relative_to(ROOT)} -> v{clean_version}")

    # 7. Desktop UI components (Sidebar & SettingsModal)
    for comp_path in [
        ROOT / "desktop" / "src" / "components" / "Sidebar.tsx",
        ROOT / "desktop" / "src" / "components" / "SettingsModal.tsx",
    ]:
        if comp_path.exists():
            content = comp_path.read_text(encoding="utf-8")
            content = re.sub(r'v\d+\.\d+\.\d+', f'v{clean_version}', content)
            content = re.sub(r'VibeCast \d+\.\d+\.\d+', f'VibeCast {clean_version}', content)
            comp_path.write_text(content, encoding="utf-8")
            print(f"Updated {comp_path.relative_to(ROOT)} -> v{clean_version}")

    print(f"\nAll components bumped to version v{clean_version} successfully!")

if __name__ == "__main__":
    ver = sys.argv[1] if len(sys.argv) > 1 else "0.2.0"
    code = int(sys.argv[2]) if len(sys.argv) > 2 else 2
    bump_version(ver, code)
