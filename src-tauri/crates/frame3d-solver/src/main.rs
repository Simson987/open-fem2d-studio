//! JSON stdin/stdout bridge for the browser development build and automation.

use std::io::{Read, Write};

fn main() {
    let mut input = String::new();
    let result = std::io::stdin()
        .read_to_string(&mut input)
        .map_err(|error| format!("stdin niet leesbaar: {error}"))
        .and_then(|_| {
            serde_json::from_str(&input)
                .map_err(|error| format!("3D-verzoek niet te lezen: {error}"))
        })
        .and_then(frame3d_solver::solve)
        .and_then(|result| serde_json::to_string(&result).map_err(|error| error.to_string()));
    let (body, code) = match result {
        Ok(body) => (body, 0),
        Err(error) => (serde_json::json!({ "fout": error }).to_string(), 1),
    };
    let _ = std::io::stdout().write_all(body.as_bytes());
    std::process::exit(code);
}
