#!/usr/bin/env bash
set -eo pipefail

# This script downloads and extracts the pandoc releases. This script needs
# to be updated in order to ship newer versions. The versions are hardcoded here
# because this gives us more control over the built-in pandoc binary.

# Retrieve the versions from https://github.com/jgm/pandoc/releases/latest
VERSION="3.14"

BASE_PATH="https://github.com/jgm/pandoc/releases/download/$VERSION"

PANDOC_LINUX_X64="$BASE_PATH/pandoc-$VERSION-linux-amd64.tar.gz"
PANDOC_LINUX_ARM="$BASE_PATH/pandoc-$VERSION-linux-arm64.tar.gz"
PANDOC_WIN32_X64="$BASE_PATH/pandoc-$VERSION-windows-x86_64.zip"
PANDOC_MACOS_X64="$BASE_PATH/pandoc-$VERSION-x86_64-macOS.zip"
PANDOC_MACOS_ARM="$BASE_PATH/pandoc-$VERSION-arm64-macOS.zip"

# Prepare our global variables
PLATFORM="$1"
ARCH="$2"
RELEASE=""

# Now check the arguments. This script requires one parameter, and takes an
# optional second one. Also make sure to check the required one
if [ "$#" -eq 0 ] || ([ "$PLATFORM" != "darwin" ] && [ "$PLATFORM" != "win32" ] && [ "$PLATFORM" != "linux" ])
then
    # Print out usage information
    echo "Pandoc retrieval script"
    echo ""
    echo "This script can download Pandoc directly from GitHub for all supported operating systems."
    echo ""
    echo "USAGE:"
    echo "    ./get-pandoc.sh linux|darwin|win32 x64|arm"
    echo ""
    echo "    The first parameter (the platform) is required."
    echo "    The second parameter (the architecture) defaults to x64, if not provided."
    exit 1
fi

if [ "$ARCH" != "x64" ] && [ "$ARCH" != "arm" ]
then
    # If no (or a non-existing) architecture is given, assume x64
    if [ "$ARCH" != "" ]
    then
        # Give out a warning
        echo "WARNING: Unknown architecture: $ARCH. Falling back to x64"
    fi
    ARCH="x64"
fi

if [ "$PLATFORM" == "darwin" ] && [ "$ARCH" == "arm" ]
then
    RELEASE="$PANDOC_MACOS_ARM"
elif [ "$PLATFORM" == "darwin" ] && [ "$ARCH" == "x64" ]
then
    RELEASE="$PANDOC_MACOS_X64"
elif [ "$PLATFORM" == "linux" ] && [ "$ARCH" == "arm" ]
then
    RELEASE="$PANDOC_LINUX_ARM"
elif [ "$PLATFORM" == "linux" ] && [ "$ARCH" == "x64" ]
then
    RELEASE="$PANDOC_LINUX_X64"
elif [ "$PLATFORM" == "win32" ] && [ "$ARCH" == "arm" ]
then
    echo "Currently there is no ARM-release for Windows. Aborting." >&2
    exit 1
elif [ "$PLATFORM" == "win32" ] && [ "$ARCH" == "x64" ]
then
    RELEASE="$PANDOC_WIN32_X64"
fi

# Stage the download beside the finished binary and clean up on failure.
RESOURCES_DIR="$(CDPATH= cd -- "$(dirname "$0")/../resources" && pwd)"
DOWNLOAD_DIR="$(mktemp -d "$RESOURCES_DIR/pandoc-download.XXXXXX")"
trap 'rm -rf -- "$DOWNLOAD_DIR"' EXIT
cd "$DOWNLOAD_DIR"

BASENAME="${RELEASE##*/}"
echo "Downloading: $BASENAME ..."
curl --fail --silent --show-error --location "$RELEASE" -o "$BASENAME"
echo "Extracting ..."

if [ "$PLATFORM" == "darwin" ]
then
    # macOS builds are a zip file where the binary is in ./bin
    unzip -qq "$BASENAME"
    FIRST_ENTRY="$(unzip -Z -1 "$BASENAME" | sed -n '1p')"
    mv "${FIRST_ENTRY%%/*}/bin/pandoc" "$RESOURCES_DIR/pandoc-darwin-$ARCH"
elif [ "$PLATFORM" == "linux" ]
then
    # Linux builds are a tar.gz file where the binary is in ./bin
    tar -xzf "$BASENAME"
    FIRST_ENTRY="$(tar -tzf "$BASENAME" | sed -n '1p')"
    mv "${FIRST_ENTRY%%/*}/bin/pandoc" "$RESOURCES_DIR/pandoc-linux-$ARCH"
elif [ "$PLATFORM" == "win32" ]
then
    # Windows archives can have a top-level folder or the binary at the root.
    # Unzip with -j to discard the directory paths.
    unzip -qq -d extracted -j "$BASENAME"
    mv extracted/pandoc.exe "$RESOURCES_DIR/pandoc-win32-$ARCH.exe"
fi

echo "Successfully downloaded Pandoc for $PLATFORM/$ARCH!"
