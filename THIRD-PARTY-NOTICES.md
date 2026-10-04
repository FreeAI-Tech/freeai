# Third-party material

FreeAI's first-party source is licensed under MIT, as authorized by Li Jinlong
(Alan Li). Third-party code and linked research retain their own licenses and
copyrights. The FreeAI license does not relicense linked papers, external sites,
trademarks or dependency packages.

The release archive contains the dependency lockfile rather than vendored
dependency code. `npm ci` installs packages with their own notices. Preserve
their license files if redistributing an installed application or container.

Locked packages at this release (from `server/package-lock.json`):

| Package | Version | Declared license |
| --- | --- | --- |
| @types/node | 26.6.4 | MIT |
| aws-ssl-profiles | 1.1.2 | MIT |
| generate-function | 2.3.1 | MIT |
| iconv-lite | 0.7.3 | MIT |
| is-property | 1.0.2 | MIT |
| long | 5.3.2 | Apache-2.0 |
| lru.min | 1.1.5 | MIT |
| mysql2 | 3.24.5 | MIT |
| named-placeholders | 1.1.6 | MIT |
| safer-buffer | 2.1.2 | MIT |
| sql-escaper | 1.5.2 | MIT |
| undici-types | 8.9.0 | MIT |

This inventory records package metadata; it does not replace the original
license texts supplied with each dependency. Regenerate it when the lockfile
changes.
