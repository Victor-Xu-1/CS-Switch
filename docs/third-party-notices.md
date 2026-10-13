# Third-party boundaries

CS-Switch's first-party source is licensed under MIT; see [LICENSE](../LICENSE).
That grant covers CS-Switch only and does not grant rights to redistribute or
relicense the original Claude Science / Operon application or third-party services.

CS-Switch is independent of Anthropic. Claude Science, Operon and other names
identify the external software/protocols being integrated. Their trademarks,
binaries, application code, assets and licenses remain their owners'. They are
not included in this source repository.

Runtime dependencies are pinned in package-lock.json and retain their own
licenses: Acorn (JavaScript parsing), node-tar (bounded archive extraction),
Undici (HTTP/proxy transport), and Cheerio (HTML search-result parsing), plus
their transitive dependencies.

The standalone extraction format was cross-checked against the public Bun
module-graph format and [can1357/unbun](https://github.com/can1357/unbun), an MIT
licensed format reference. CS-Switch implements its own bounded Node.js reader
and preserves all embedded assets needed by the user's local installation.

The official release verification public key and signature domain format were
read from the user's installed official Operon 0.1.47 updater. These are public
verification material, not account credentials. A publisher key rotation needs
an explicit trust update.

Web search uses DuckDuckGo's public HTML endpoint and returns source titles,
URLs and bounded excerpts. It does not bypass challenges or access controls.
