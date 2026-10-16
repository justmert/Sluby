#!/usr/bin/env bash
# decides whether a pushed tag may publish, for .github/workflows/release.yml.
# prints name=, dir=, version= and dist_tag= lines for $GITHUB_OUTPUT, or
# exits 1 with the reason. refuses:
# - anything but a tag of the form sdk-vX.Y.Z or player-vX.Y.Z (optionally
#   with a -prerelease suffix) in the expected repository
# - a tag whose commit is not on main, so only reviewed code is published
# - a tag that does not match the version in the package's package.json
#
#   REF_TYPE=tag REF_NAME=sdk-v0.2.0 SHA=$(git rev-parse HEAD) \
#     REPOSITORY=justmert/Sluby scripts/release-check.sh
set -euo pipefail

: "${REF_TYPE:?}" "${REF_NAME:?}" "${SHA:?}" "${REPOSITORY:?}"
expected_repository="${EXPECTED_REPOSITORY:-justmert/Sluby}"
main_ref="${MAIN_REF:-origin/main}"

refuse() {
  echo "refusing to publish: $*" >&2
  exit 1
}

[ "$REPOSITORY" = "$expected_repository" ] || refuse "this is $REPOSITORY, not $expected_repository"
[ "$REF_TYPE" = tag ] || refuse "$REF_NAME is a $REF_TYPE, not a tag"

semver='[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?'
if [[ "$REF_NAME" =~ ^sdk-v($semver)$ ]]; then
  name=@sluby/sdk dir=packages/sdk
elif [[ "$REF_NAME" =~ ^player-v($semver)$ ]]; then
  name=@sluby/player dir=packages/player
else
  refuse "tag $REF_NAME is not sdk-vX.Y.Z or player-vX.Y.Z"
fi
version="${BASH_REMATCH[1]}"

git rev-parse --verify --quiet "$main_ref" >/dev/null || refuse "$main_ref is not fetched"
git merge-base --is-ancestor "$SHA" "$main_ref" || refuse "$SHA is not on main"

actual="$(node -p "require('./$dir/package.json').version")"
[ "$actual" = "$version" ] || refuse "tag $REF_NAME says $version but $dir/package.json is $actual"

# npm refuses to publish a prerelease as latest; it goes out as next
if [[ "$version" == *-* ]]; then dist_tag=next; else dist_tag=latest; fi

echo "name=$name"
echo "dir=$dir"
echo "version=$version"
echo "dist_tag=$dist_tag"
