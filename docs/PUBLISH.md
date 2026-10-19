# Publishing `@geekplux/vert`

The package is `dist-lib/` (`pnpm build:lib`) with `package.json`, `LICENSE` and `README.md`
(`files` in package.json). Releases are published from GitHub Actions
(`.github/workflows/release.yml`) with npm trusted publishing: no token is stored anywhere.

## Once: the first version, by hand

npm lets a trusted publisher be set only on a package that exists, so 0.2.0 goes up by hand:

```sh
git switch main && git pull     # a clean main: pnpm refuses a dirty tree or another branch
pnpm install --frozen-lockfile
npm login                       # the geekplux account
pnpm publish                    # prepublishOnly builds dist-lib/ and refuses a .dirty build
```

Do not push a `v0.2.0` tag: `release.yml` would try to publish 0.2.0 again and fail.

Then on npmjs.com: the package → **Settings** → **Trusted publishing** → **GitHub Actions**:
owner `geekplux`, repository `vert`, workflow `release.yml`, environment left blank.

## Every release after that

1. In a pull request: bump `version` in `package.json`, add its entry at the top of the
   changelog (`docs/INTEGRATION.md` §11, `### <version> (<date>)`; `scripts/release.test.ts`
   checks they agree), and bump `DEV_VERSION` in `src/vert-lib/version.ts`. Merge it.
2. Tag the merge and push the tag:

   ```sh
   git switch main && git pull
   git tag v0.2.1 && git push origin v0.2.1
   ```

`release.yml` runs the whole check (`check.yml`), fails unless the tag is `v` + `package.json`'s
version, and runs `npm publish --provenance --access public`, whose `prepublishOnly` builds
`dist-lib/` from the tagged commit.
