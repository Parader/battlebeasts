/** Packaged Electron (or file://) client — not the browser site. */
export function isDesktopApp() {
    return (
        typeof window !== "undefined" &&
        (window.battlebeasts?.isElectron === true || window.location.protocol === "file:")
    );
}

/** Close the desktop process. Returns false on the web (no-op). */
export async function quitDesktopApp(): Promise<boolean> {
    if (!window.battlebeasts?.quit) return false;
    await window.battlebeasts.quit();
    return true;
}
