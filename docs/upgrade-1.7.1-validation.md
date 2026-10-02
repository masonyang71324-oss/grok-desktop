# 1.7.1 validation

This release contains the [sixteen implemented upgrades and their scoped module evidence](upgrade-1.7.0-validation.md). Version1.7.0 was a candidate only: cloud E2E prevented its publication when fast navigation revealed delayed UI settings persistence.

The correction persists each navigation transition immediately, including returning to an earlier selection before its previous save is acknowledged. Panel dimensions save on pointer release, keyboard changes or reset, without per-pixel disk writes. Two browser regressions reproduced the original failures, then passed after the fix; the scoped review found no remaining issue.

Final local validation: **420/420 tests**, format and production build passed; the complete source and packaged Electron suites passed, including all ten new integration phases. NSIS and portable1.7.1 builds passed. Final packaged fixture: `dZ1ls9`. Cloud results are recorded with the [release](https://github.com/masonyang71324-oss/grok-desktop/releases/tag/v1.7.1).

The implementation keeps all1.7.0 documented scopes: Office layouts are readonly and approximate, voice input uses Windows, no paid/model/microphone requests or real user configuration were used for tests.
