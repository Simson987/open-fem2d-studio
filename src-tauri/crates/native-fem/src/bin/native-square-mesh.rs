use std::io::{Read, Write};
fn main() {
    let mut text = String::new();
    let result = std::io::stdin()
        .read_to_string(&mut text)
        .map_err(|e| e.to_string())
        .and_then(|_| {
            serde_json::from_str::<openaec_native_fem::quad2d::SquareGrid>(&text)
                .map_err(|e| e.to_string())
        })
        .and_then(|grid| openaec_native_fem::quad2d::mesh_squares(&grid));
    let (json, code) = match result {
        Ok(value) => (serde_json::to_string(&value).unwrap(), 0),
        Err(error) => (serde_json::json!({"error":error}).to_string(), 1),
    };
    let _ = std::io::stdout().write_all(json.as_bytes());
    std::process::exit(code);
}
