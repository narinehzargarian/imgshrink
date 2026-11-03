# Contributing

Thanks for helping. Bug reports with a sample image (one you're allowed to share) are the most useful thing you can send.

## Ground rules

- **Images never leave the device.** No uploads, analytics, or third-party requests. The browser test `nothing is uploaded` enforces this.
- **Never make a file worse.** If an option can produce a bigger file than the input at the same size and format, the app should offer the original.
- **C++ changes come with tests** in `core/tests`, and must pass under the sanitizers.

## Making a change

1. Follow the setup in the README's Development section.
2. If you change anything in `core/`, rebuild the WebAssembly module with `./scripts/build-wasm.sh`.
3. Run everything before opening a pull request:

   ```sh
   core/build/imgshrink_tests
   core/build-asan/imgshrink_tests
   cd web && npm run typecheck && npm test && npm run test:e2e
   ```

4. If your change could affect speed, run `npm run bench` before and after and include both results.
