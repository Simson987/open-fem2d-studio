use std::io::{self, Read};

fn main() {
    let mut text = String::new();
    let result = io::stdin()
        .read_to_string(&mut text)
        .map_err(|error| error.to_string())
        .and_then(|_| {
            serde_json::from_str::<openaec_native_fem::mixed2d::Request>(&text)
                .map_err(|error| error.to_string())
        })
        .and_then(|request| openaec_native_fem::mixed2d::solve(&request));
    match result {
        Ok(output) => println!("{}", serde_json::to_string(&output).unwrap()),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
