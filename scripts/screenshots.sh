#!/bin/zsh
# Records the README images (images/overview.png, images/data.gif, images/quick-fix.gif) in a clean VS Code window.
# macOS only. Needs ffmpeg, and the app that runs this needs the Screen Recording permission.
# The typing is done inside VS Code by scripts/demo-driver, so no key presses are sent and no Accessibility
# permission is needed. The VS Code window must come to the front: VS Code does not draw a window that is hidden
# or in another Space, so leave full screen in the app that runs this.
#
# usage: zsh scripts/screenshots.sh

set -e
zmodload zsh/datetime
REPO=${0:A:h:h}
VSCODE="/Applications/Visual Studio Code.app"
CODE_CLI="$VSCODE/Contents/Resources/app/bin/code"
# kept short on purpose: VS Code's socket path must stay under 103 characters
WORK=${TMPDIR}alo-shots
PROFILE=$WORK/profile
EXT=$WORK/ext
SITE=$WORK/alo-site
PAGE="pages/(site)/contact/page.alo"
rm -rf $PROFILE $SITE
mkdir -p $PROFILE/User $EXT $REPO/images

clean_env=(env -u ELECTRON_RUN_AS_NODE -u VSCODE_IPC_HOOK -u VSCODE_IPC_HOOK_CLI -u VSCODE_PID -u VSCODE_CWD
    -u VSCODE_ESM_ENTRYPOINT -u VSCODE_HANDLES_UNCAUGHT_ERRORS -u VSCODE_NLS_CONFIG -u VSCODE_CODE_CACHE_PATH
    -u VSCODE_CRASH_REPORTER_PROCESS_TYPE)

echo "Packaging the extension and the demo driver"
(cd $REPO && npm exec --no -- vsce package --out $WORK/alo.vsix >/dev/null 2>&1)
(cd $REPO/scripts/demo-driver && $REPO/node_modules/.bin/vsce package --allow-missing-repository --skip-license \
    --out $WORK/driver.vsix >/dev/null 2>&1)
for vsix in $WORK/alo.vsix $WORK/driver.vsix msilabs.msilabs-theme; do
    $clean_env "$CODE_CLI" --extensions-dir $EXT --user-data-dir $WORK/cli --install-extension $vsix --force >/dev/null 2>&1
done

cp -R $REPO/test/fixtures/site $SITE
mkdir -p "$SITE/${PAGE:h}"

cat > $WORK/window.swift <<'SWIFT'
import AppKit
// usage: window <pid>  brings that VS Code to the front and prints its window id, if the window is on screen
let pid = Int32(CommandLine.arguments[1])!
NSRunningApplication(processIdentifier: pid)?.activate(options: [.activateAllWindows])
Thread.sleep(forTimeInterval: 2)
for w in CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as! [[String: Any]]
    where (w[kCGWindowOwnerPID as String] as? Int32) == pid && (w[kCGWindowName as String] as? String ?? "") != "" {
    print(w[kCGWindowNumber as String] as! Int)
    break
}
SWIFT
swiftc -O $WORK/window.swift -o $WORK/window

cat > $PROFILE/User/settings.json <<JSON
{
    "workbench.colorTheme": "msilabs Dark",
    "workbench.startupEditor": "none",
    "window.restoreWindows": "none",
    "window.commandCenter": false,
    "workbench.layoutControl.enabled": false,
    "workbench.tips.enabled": false,
    "workbench.secondarySideBar.defaultVisibility": "hidden",
    "workbench.activityBar.location": "hidden",
    "workbench.statusBar.visible": false,
    "workbench.editor.decorations.colors": false,
    "workbench.editor.decorations.badges": false,
    "breadcrumbs.enabled": false,
    "update.mode": "none",
    "telemetry.telemetryLevel": "off",
    "extensions.ignoreRecommendations": true,
    "security.workspace.trust.enabled": false,
    "chat.disableAIFeatures": true,
    "git.enabled": false,
    "editor.fontSize": 15,
    "editor.lineHeight": 24,
    "editor.minimap.enabled": false,
    "editor.stickyScroll.enabled": false,
    "editor.cursorBlinking": "solid",
    "editor.wordBasedSuggestions": "off",
    "emmet.showExpandedAbbreviation": "never",
    "files.hotExit": "off",
    "editor.snippetSuggestions": "none",
    "files.exclude": { "**/dist": true, "**/.alo": true }
}
JSON

write_page() {
    local tag=$1
    cat > "$SITE/$PAGE" <<ALO
<head>
    <title>Contact | {{ data.site.name }}</title>
</head>

<template>
    <section class="contact">
        <h1>Contact</h1>
        <$tag title="Email">
            <p>hello@example.com</p>
        </$tag>
        
    </section>
</template>

<style>
    .contact {
        max-width: 40rem;
        margin: 4rem auto;
    }
</style>
ALO
}

wait_for() {
    for i in {1..300}; do [ -f $WORK/$1 ] && return 0; sleep 0.2; done
    echo "Timed out waiting for $1"; return 1
}

# usage: open_window <scene> <page tag>
open_window() {
    echo $1 > $WORK/scene
    rm -f $WORK/ready $WORK/go $WORK/done
    write_page $2
    rm -rf $PROFILE/Backups
    local state=$PROFILE/User/globalStorage/storage.json
    [ -f $state ] && python3 -I -c "
import json, sys
d = json.load(open(sys.argv[1]))
w = d.get('windowsState', {}).get('lastActiveWindow')
if w: w['uiState'] = {'mode': 1, 'x': 0, 'y': 33, 'width': 1280, 'height': 760}
json.dump(d, open(sys.argv[1], 'w'))
" $state
    ($clean_env ALO_SHOTS_DIR=$WORK "$VSCODE/Contents/MacOS/Code" --user-data-dir $PROFILE --extensions-dir $EXT \
        --new-window "$SITE" "$SITE/$PAGE" >/dev/null 2>&1 &)
    wait_for ready
    local pid=$(pgrep -f "MacOS/Code --user-data-dir $PROFILE" | head -1)
    for try in 1 2 3; do
        osascript -e "tell application \"System Events\" to set frontmost of (first process whose unix id is $pid) to true"
        WIN=$($WORK/window $pid)
        [ -n "$WIN" ] && break
    done
    [ -n "$WIN" ] || { echo "The VS Code window did not come to the front. Leave full screen and try again."; close_window; return 1; }
}

close_window() {
    pkill -9 -f "user-data-dir $PROFILE" || true
    sleep 3
}

play() {
    touch $WORK/go
    wait_for done
}

record() {
    # screencapture by window id gives about 6 frames a second; the real rate is measured to keep the timing right
    rm -rf $WORK/frames && mkdir -p $WORK/frames
    local start=$EPOCHREALTIME n=0
    touch $WORK/go
    until [ -f $WORK/done ]; do
        n=$((n + 1))
        screencapture -o -x -l $WIN $WORK/frames/$(printf %04d $n).png
    done
    for i in {1..4}; do n=$((n + 1)); cp $WORK/frames/$(printf %04d $((n - 1))).png $WORK/frames/$(printf %04d $n).png; done
    local fps=$(( n / (EPOCHREALTIME - start + 0.7) ))
    ffmpeg -loglevel error -y -framerate $fps -i $WORK/frames/%04d.png -vf \
        "scale=1200:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=none" \
        $REPO/images/$1
    echo "Saved images/$1 ($(du -h $REPO/images/$1 | cut -f1), $n frames)"
}

# The first window only creates the profile, so the window size applies from the next one
open_window warmup Card || true
close_window

open_window overview Card
play
screencapture -o -x -l $WIN $WORK/overview.png
sips -Z 1600 $WORK/overview.png --out $REPO/images/overview.png >/dev/null
echo "Saved images/overview.png"
close_window

open_window data Card
record data.gif
close_window

open_window quickFix Crad
record quick-fix.gif
close_window

echo "Done"
