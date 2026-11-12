/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

package service

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"hash/crc32"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestProcessUserAvatarImage(t *testing.T) {
	const prefix = "data:image/jpeg;base64,"

	t.Run("center-crops to a square JPEG data URL", func(t *testing.T) {
		src := image.NewRGBA(image.Rect(0, 0, 640, 480))
		for y := range 480 {
			for x := range 640 {
				if x < 320 {
					src.Set(x, y, color.RGBA{R: 255, A: 255})
					continue
				}
				src.Set(x, y, color.RGBA{B: 255, A: 255})
			}
		}

		var encoded bytes.Buffer
		require.NoError(t, png.Encode(&encoded, src))
		dataURL, err := ProcessUserAvatarImage(encoded.Bytes())
		require.NoError(t, err)
		require.True(t, strings.HasPrefix(dataURL, prefix))
		require.LessOrEqual(t, len(dataURL), userAvatarMaxDataURLBytes)

		raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(dataURL, prefix))
		require.NoError(t, err)
		decoded, err := jpeg.Decode(bytes.NewReader(raw))
		require.NoError(t, err)
		require.Equal(t, userAvatarSize, decoded.Bounds().Dx())
		require.Equal(t, userAvatarSize, decoded.Bounds().Dy())

		left := color.RGBAModel.Convert(decoded.At(64, 128)).(color.RGBA)
		right := color.RGBAModel.Convert(decoded.At(192, 128)).(color.RGBA)
		assert.Greater(t, left.R, uint8(180), "left half stays red after the crop")
		assert.Less(t, left.B, uint8(80))
		assert.Greater(t, right.B, uint8(180), "right half stays blue after the crop")
		assert.Less(t, right.R, uint8(80))
	})

	t.Run("flattens transparency onto white", func(t *testing.T) {
		src := image.NewRGBA(image.Rect(0, 0, 32, 32))
		for y := range 32 {
			for x := range 32 {
				if x >= 8 && x < 24 && y >= 8 && y < 24 {
					src.Set(x, y, color.RGBA{R: 255, A: 255})
				}
			}
		}

		var encoded bytes.Buffer
		require.NoError(t, png.Encode(&encoded, src))
		dataURL, err := ProcessUserAvatarImage(encoded.Bytes())
		require.NoError(t, err)

		raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(dataURL, prefix))
		require.NoError(t, err)
		decoded, err := jpeg.Decode(bytes.NewReader(raw))
		require.NoError(t, err)
		corner := color.RGBAModel.Convert(decoded.At(8, 8)).(color.RGBA)
		assert.Greater(t, corner.R, uint8(235), "transparent pixels become white, not black")
		assert.Greater(t, corner.G, uint8(235))
		assert.Greater(t, corner.B, uint8(235))
	})

	t.Run("rejects non-image payloads", func(t *testing.T) {
		dataURL, err := ProcessUserAvatarImage([]byte("this is not an image"))
		require.ErrorIs(t, err, ErrUserAvatarUnsupportedFormat)
		assert.Empty(t, dataURL)
	})

	t.Run("rejects decompression bombs before decoding", func(t *testing.T) {
		dataURL, err := ProcessUserAvatarImage(pngHeader(10000, 10000))
		require.ErrorIs(t, err, ErrUserAvatarTooLarge)
		assert.Empty(t, dataURL)
	})
}

// pngHeader builds a PNG stream whose IHDR claims the requested dimensions. It
// is never fully decoded, so only the signature and IHDR chunk need to be valid.
func pngHeader(width, height uint32) []byte {
	ihdr := make([]byte, 13)
	binary.BigEndian.PutUint32(ihdr[0:4], width)
	binary.BigEndian.PutUint32(ihdr[4:8], height)
	ihdr[8] = 8 // bit depth
	ihdr[9] = 6 // color type: RGBA

	var chunk bytes.Buffer
	chunk.WriteString("IHDR")
	chunk.Write(ihdr)
	dataLen := chunk.Len() - len("IHDR")
	binary.Write(&chunk, binary.BigEndian, crc32.ChecksumIEEE(chunk.Bytes()))

	var out bytes.Buffer
	out.Write([]byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a})
	binary.Write(&out, binary.BigEndian, uint32(dataLen))
	out.Write(chunk.Bytes())
	return out.Bytes()
}
