#[cfg(test)]
mod tests {
    use rpm::{CompressionWithLevel, FileOptions, IndexTag, PackageBuilder, Sha256Writer};
    use sha2::{Digest, Sha256};
    use std::{
        fs,
        io::{self, Read, Write},
        time::{SystemTime, UNIX_EPOCH},
    };

    struct ShortWriter;
    impl Write for ShortWriter {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            Ok(bytes.len().min(3))
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn hashes_only_the_bytes_accepted_by_a_short_writer() {
        let mut writer = Sha256Writer::new(ShortWriter);
        writer.write_all(b"abcdef").unwrap();
        assert_eq!(
            writer.into_digest().as_ref(),
            Sha256::digest(b"abcdef").as_slice()
        );
    }

    #[test]
    fn gzip_rpm_has_valid_compressed_and_uncompressed_digests() {
        let mut bytes = fs::read(std::env::var("ZCLAUDIA_RPM_SAMPLE_BIN").unwrap()).unwrap();
        bytes.truncate(2 * 1024 * 1024);
        let sample = std::env::temp_dir().join(format!(
            "zc-rpm-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::write(&sample, bytes).unwrap();
        let package = PackageBuilder::new(
            "zclaudia-probe",
            "1.0.0",
            "MIT",
            "x86_64",
            "RPM digest probe",
        )
        .compression(CompressionWithLevel::Gzip(6))
        .with_file(&sample, FileOptions::new("/usr/bin/probe"))
        .unwrap()
        .build()
        .unwrap();
        fs::remove_file(sample).unwrap();
        package.verify_digests().unwrap();
        let mut archive = Vec::new();
        flate2::read::GzDecoder::new(package.content.as_slice())
            .read_to_end(&mut archive)
            .unwrap();
        let expected = format!("{:x}", Sha256::digest(archive));
        let declared = package
            .metadata
            .header
            .get_entry_data_as_string_array(IndexTag::RPMTAG_PAYLOADDIGESTALT)
            .unwrap();
        assert_eq!(declared, &[expected]);
    }
}
