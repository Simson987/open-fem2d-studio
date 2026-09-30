//! JSON stdin/stdout bridge for the native frame reference kernel.
use std::io::{Read, Write};

fn main() {
    let mut text = String::new();
    let result = std::io::stdin()
        .read_to_string(&mut text)
        .map_err(|error| error.to_string())
        .and_then(|_| {
            serde_json::from_str::<openaec_native_fem::frame3d::Request>(&text)
                .map_err(|error| error.to_string())
        })
        .and_then(|request| openaec_native_fem::frame3d::solve(&request));
    let (json, code) = match result {
        Ok(result) => (serde_json::to_string(&result).unwrap(), 0),
        Err(message) => (serde_json::json!({ "error": message }).to_string(), 1),
    };
    let _ = std::io::stdout().write_all(json.as_bytes());
    std::process::exit(code);
}
