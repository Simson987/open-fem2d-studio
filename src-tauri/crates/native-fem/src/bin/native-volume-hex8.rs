use std::io::{Read, Write};

fn main() {
    let mut input = String::new();
    let result = std::io::stdin()
        .read_to_string(&mut input)
        .map_err(|error| error.to_string())
        .and_then(|_| {
            serde_json::from_str::<openaec_native_fem::volume_hex8::Hex8VolumeRequest>(&input)
                .map_err(|error| error.to_string())
        })
        .and_then(openaec_native_fem::volume_hex8::solve_hex8_volume);
    let (json, code) = match result {
        Ok(value) => (serde_json::to_string(&value).unwrap(), 0),
        Err(error) => (serde_json::json!({"error":error}).to_string(), 1),
    };
    let _ = std::io::stdout().write_all(json.as_bytes());
    std::process::exit(code);
}
