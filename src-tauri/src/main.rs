// Release builds link as a GUI app so Windows doesn't open a console window
// next to the app. Debug builds keep the console for solver/panic output.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Vóór Tauri en de webview: bij de eerste start na de naamswijziging de
    // app-datamappen van de vorige identifier overnemen (instellingen,
    // recente bestanden, localStorage). Alleen als de nieuwe map nog niet
    // bestaat; kopiëren, niet verplaatsen. Zie crates/appdata-migratie.
    appdata_migratie::neem_oude_appdata_over();
    open_fem_studio_lib::run()
}
