# Structured and legacy presentation fixtures

The `.ppt` files and `SampleShow.txt` in this folder are public Apache POI test
fixtures, retrieved on 2026-09-08 from the Apache Software Foundation's repository:

- [basic_test_ppt_file.ppt](https://github.com/apache/poi/blob/trunk/test-data/slideshow/basic_test_ppt_file.ppt): two slides with corresponding notes.
- [54880_chinese.ppt](https://github.com/apache/poi/blob/trunk/test-data/slideshow/54880_chinese.ppt): mixed CJK, half-width and supplementary Unicode text.
- [SampleShow.ppt](https://github.com/apache/poi/blob/trunk/test-data/slideshow/SampleShow.ppt) and [SampleShow.txt](https://github.com/apache/poi/blob/trunk/test-data/slideshow/SampleShow.txt): presentation and independently maintained readable expected contents.

Apache POI's [license](https://github.com/apache/poi/blob/trunk/legal/LICENSE) and
[notice](https://github.com/apache/poi/blob/trunk/legal/NOTICE) are reproduced in
`LICENSE-Apache-POI.txt` and `NOTICE-Apache-POI.txt`. Fixtures are read only; no
macros, embedded objects, external references or converters are executed.

Other fixtures are generated in the two test files, including the two-edit binary
PPT with deleted text, reordered live slides and current notes. Binary structures
follow Microsoft's [MS-PPT active-record procedure](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/1fc22d56-28f9-4818-bd45-67c2bf721ccf).
