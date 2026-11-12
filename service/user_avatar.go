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
	"errors"
	"fmt"
	"image"
	"image/color"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"

	"golang.org/x/image/draw"
	"golang.org/x/image/webp"
)

const (
	// UserAvatarMaxUploadBytes bounds the uploaded file accepted for an avatar.
	UserAvatarMaxUploadBytes int64 = 5 << 20
	// userAvatarSize is the square edge length of a stored avatar.
	userAvatarSize = 256
	// userAvatarMaxSourcePixels rejects decompression bombs before decoding.
	userAvatarMaxSourcePixels = 40_000_000
	// userAvatarMaxDataURLBytes keeps the stored data URL inside a MySQL TEXT
	// column (64 KiB) once the JPEG payload is base64 encoded.
	userAvatarMaxDataURLBytes = 60 << 10
)

var (
	ErrUserAvatarUnsupportedFormat = errors.New("unsupported avatar image format")
	ErrUserAvatarTooLarge          = errors.New("avatar image is too large")
)

// ProcessUserAvatarImage normalizes an uploaded image into a square JPEG data
// URL. Avatars are stored in the user row, so the result is deliberately small:
// 256px, quality reduced, and re-encoded to strip metadata.
func ProcessUserAvatarImage(raw []byte) (string, error) {
	src, err := decodeUserAvatarImage(raw)
	if err != nil {
		return "", err
	}

	for _, size := range []int{userAvatarSize, userAvatarSize * 3 / 4, userAvatarSize / 2} {
		thumb := squareAvatarThumbnail(src, size)
		for _, quality := range []int{85, 70} {
			var buf bytes.Buffer
			if err := jpeg.Encode(&buf, thumb, &jpeg.Options{Quality: quality}); err != nil {
				return "", fmt.Errorf("encode avatar: %w", err)
			}
			dataURL := "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())
			if len(dataURL) <= userAvatarMaxDataURLBytes {
				return dataURL, nil
			}
		}
	}
	return "", ErrUserAvatarTooLarge
}

func decodeUserAvatarImage(raw []byte) (image.Image, error) {
	config, format, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil {
		config, err = webp.DecodeConfig(bytes.NewReader(raw))
		if err != nil {
			return nil, ErrUserAvatarUnsupportedFormat
		}
		format = "webp"
	}
	if config.Width <= 0 || config.Height <= 0 {
		return nil, ErrUserAvatarUnsupportedFormat
	}
	if int64(config.Width)*int64(config.Height) > userAvatarMaxSourcePixels {
		return nil, ErrUserAvatarTooLarge
	}

	if format == "webp" {
		img, err := webp.Decode(bytes.NewReader(raw))
		if err != nil {
			return nil, ErrUserAvatarUnsupportedFormat
		}
		return img, nil
	}
	img, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, ErrUserAvatarUnsupportedFormat
	}
	return img, nil
}

// squareAvatarThumbnail center-crops src and scales it onto a white canvas so
// transparent PNGs do not turn black when encoded as JPEG.
func squareAvatarThumbnail(src image.Image, size int) image.Image {
	bounds := src.Bounds()
	side := min(bounds.Dx(), bounds.Dy())
	if side <= 0 {
		return image.NewRGBA(image.Rect(0, 0, size, size))
	}
	offsetX := bounds.Min.X + (bounds.Dx()-side)/2
	offsetY := bounds.Min.Y + (bounds.Dy()-side)/2
	source := image.Rect(offsetX, offsetY, offsetX+side, offsetY+side)

	scaled := image.NewRGBA(image.Rect(0, 0, size, size))
	draw.CatmullRom.Scale(scaled, scaled.Bounds(), src, source, draw.Src, nil)

	canvas := image.NewRGBA(scaled.Bounds())
	draw.Draw(canvas, canvas.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	draw.Draw(canvas, canvas.Bounds(), scaled, image.Point{}, draw.Over)
	return canvas
}
