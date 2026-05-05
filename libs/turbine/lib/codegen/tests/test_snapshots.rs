use std::{
    borrow::Cow,
    fs,
    io::Write,
    path::Path,
    process::{Command, Stdio},
    time::SystemTime,
};

use codegen::Config;
use similar_asserts::assert_eq;

#[test]
fn snapshots() {
    let location = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/snapshots");
    let mut snapshots = vec![];

    // find all snapshots
    for entry in fs::read_dir(location).expect("should be able to read dir") {
        let entry = entry.expect("should be able to read entries in `snapshots/` directory");

        let file_type = entry.file_type().expect("unable to determine file type");

        if file_type.is_dir() {
            continue;
        }

        if entry
            .path()
            .extension()
            .map(std::ffi::OsStr::to_string_lossy)
            == Some(Cow::Borrowed("json"))
        {
            snapshots.push(entry.path());
        }
    }

    let overwrite = std::env::var("SNAPSHOT_MODE")
        .map_or(false, |mode| mode.to_ascii_lowercase() == "overwrite");

    for path in snapshots {
        let snapshot = fs::read_to_string(&path).expect("unable to read snapshot");
        let contents = serde_json::from_str(&snapshot).expect("snapshot is invalid JSON");

        let now = SystemTime::now();
        let output = codegen::process(contents, Config {
            timings: false,
            module: None,
            overrides: vec![],
            flavors: vec![],
        })
        .expect("able to generate valid rust");
        println!("Elapsed: {:?}", now.elapsed().unwrap());

        let output = output
            .files
            .into_iter()
            .map(|(file, stream)| {
                let mut command = Command::new("rustfmt")
                    .arg("--emit")
                    .arg("stdout")
                    .arg("--config")
                    .arg("normalize_doc_attributes=true")
                    .stdin(Stdio::piped())
                    .stdout(Stdio::piped())
                    .spawn()
                    .expect("unable to spawn rustfmt");

                command
                    .stdin
                    .take()
                    .expect("stdio piped")
                    .write_all(stream.to_string().as_bytes())
                    .expect("should be able to write to stdin");
                let output = command.wait_with_output().unwrap();

                let output = String::from_utf8(output.stdout).unwrap();
                let path = file.path;

                format!("{}\n\n{output}", path.to_string_lossy())
            })
            .reduce(|mut acc, next| {
                acc.push_str("\n\n---\n\n");
                acc.push_str(&next);
                acc
            })
            .expect("no files");

        let expected = path.with_extension("stdout");
        if overwrite {
            fs::write(expected, output).unwrap();
        } else {
            let expected = fs::read_to_string(&expected).unwrap();

            assert_eq!(output, expected);
        }
    }
}
