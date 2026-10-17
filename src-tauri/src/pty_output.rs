use std::io::{ErrorKind, Read};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread;
use std::time::Instant;

use super::{PTY_COALESCE, READ_CHUNK};

/// Bound GUI emissions without withholding a query/prompt while the pipe waits.
pub(crate) fn pump(mut reader: impl Read + Send + 'static, mut emit: impl FnMut(&[u8])) {
    let (sender, receiver) = mpsc::sync_channel(4);
    thread::spawn(move || {
        let mut bytes = vec![0; READ_CHUNK];
        loop {
            match reader.read(&mut bytes) {
                Ok(0) => break,
                Ok(count) => {
                    if sender.send(bytes[..count].to_vec()).is_err() {
                        break;
                    }
                }
                Err(error) if error.kind() == ErrorKind::Interrupted => continue,
                Err(_) => break,
            }
        }
    });
    let mut pending = Vec::with_capacity(READ_CHUNK);
    let mut since = Instant::now();
    loop {
        let chunk = if pending.is_empty() {
            receiver.recv().map_err(|_| RecvTimeoutError::Disconnected)
        } else {
            receiver.recv_timeout(PTY_COALESCE.saturating_sub(since.elapsed()))
        };
        match chunk {
            Ok(bytes) => {
                if pending.is_empty() {
                    since = Instant::now();
                }
                pending.extend_from_slice(&bytes);
                if pending.len() >= READ_CHUNK || since.elapsed() >= PTY_COALESCE {
                    emit(&pending);
                    pending.clear();
                }
            }
            Err(RecvTimeoutError::Timeout) => {
                emit(&pending);
                pending.clear();
            }
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
    if !pending.is_empty() {
        emit(&pending);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    struct OpenPipe(mpsc::Receiver<Vec<u8>>);
    impl Read for OpenPipe {
        fn read(&mut self, target: &mut [u8]) -> std::io::Result<usize> {
            match self.0.recv() {
                Ok(bytes) => {
                    target[..bytes.len()].copy_from_slice(&bytes);
                    Ok(bytes.len())
                }
                Err(_) => Ok(0),
            }
        }
    }

    #[test]
    fn query_and_prompt_reach_the_renderer_while_the_pipe_stays_open() {
        let (source, pipe) = mpsc::channel();
        let (output, renderer) = mpsc::channel();
        let worker = thread::spawn(move || {
            pump(OpenPipe(pipe), |bytes| {
                output.send(bytes.to_vec()).unwrap();
            })
        });
        source.send(b"\x1b[6n".to_vec()).unwrap();
        assert_eq!(
            renderer.recv_timeout(Duration::from_secs(1)).unwrap(),
            b"\x1b[6n"
        );
        // The child now waits for its query reply, then paints one final prompt.
        source.send("❯ ".as_bytes().to_vec()).unwrap();
        assert_eq!(
            renderer.recv_timeout(Duration::from_secs(1)).unwrap(),
            "❯ ".as_bytes()
        );
        drop(source);
        worker.join().unwrap();
    }

    #[test]
    fn a_busy_reader_preserves_every_byte_and_flushes_the_tail_on_eof() {
        let source = vec![b'x'; READ_CHUNK * 3 + 7];
        let expected = source.clone();
        let mut output = Vec::new();
        pump(std::io::Cursor::new(source), |bytes| {
            output.extend_from_slice(bytes)
        });
        assert_eq!(output, expected);
    }
}
