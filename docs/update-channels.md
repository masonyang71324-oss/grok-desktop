# Update channels and staged delivery

Users choose **Stable (recommended)** or **Beta** under Settings → Software updates. Stable clients use `latest.yml`; beta clients accept supported `-beta.N` releases and newer stable promotions. Switching back never downgrades an installed version. Channel changes wait until checks/downloads/installations are finished.

Publish a matching package version and immutable `vX.Y.Z` or `vX.Y.Z-beta.N` tag. The release workflow validates the pair, produces the corresponding manifest, and marks beta releases as GitHub prereleases without making them Latest. Existing binaries do not need a separate certification to use this capability.

Initial installed-app rollout is 100%. Set the repository Actions variable `GROK_STAGING_PERCENTAGE` to an integer from 0 through 100 before publishing to choose an initial percentage. Without that variable the workflow uses 100.

To adjust a published version, open **Actions → Adjust installed-app staged rollout → Run workflow**, then enter the existing release tag and percentage. This downloads and validates that release's manifest, changes only `stagingPercentage`, and replaces only that manifest. It does not rebuild or upload the installers, change their hashes or move the tag. Release publication and rollout operations for the same tag share a concurrency group.

Electron-updater assigns installed clients to the rollout cohort. Devices outside the cohort see a gradual-rollout message and cannot download through the in-app button yet. Portable users choose downloads manually from the selected channel's release page. Lowering a percentage does not uninstall a version or cancel an update already downloaded; stopping rollout is not a downgrade mechanism.

Validation is covered by `tests/update-channels.test.cjs`, `tests/stage-release.test.cjs` and `tests/release-workflows.test.cjs` with synthetic versions, manifests and local mocked GitHub calls; no dummy public prerelease is necessary.
