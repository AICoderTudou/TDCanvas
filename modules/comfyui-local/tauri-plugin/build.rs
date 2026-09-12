const COMMANDS: &[&str] = &[
    "select_environment",
    "select_environment_python",
    "saved_environments",
    "remove_environment",
    "start_environment",
    "stop_environment",
    "environment_status",
    "environment_logs",
    "system_stats",
    "object_info",
    "upload_input",
    "queue_workflow",
    "wait_for_execution",
    "interrupt_execution",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
