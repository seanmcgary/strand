import type { Meta, StoryObj } from "@storybook/react"
import { fn } from "storybook/test"
import { ImageUpload } from "@/components/ui/imageUpload"

// 1x1 transparent PNG data URIs — fixed strings so the story needs no blob
// or real `URL.createObjectURL` call (this component never creates one).
const RED_DOT =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
const BLUE_DOT =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="

const meta = { title: "UI/ImageUpload", component: ImageUpload } satisfies Meta<typeof ImageUpload>
export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {
  args: { id: "image-upload-empty", photos: [], onAdd: fn(), onRemove: fn() },
}

export const WithPhotos: Story = {
  args: {
    id: "image-upload-with-photos",
    label: "Add before/after photos",
    photos: [
      { previewUrl: RED_DOT, name: "photo-1.png" },
      { previewUrl: BLUE_DOT, name: "photo-2.png" },
    ],
    onAdd: fn(),
    onRemove: fn(),
  },
}

export const UploadInProgress: Story = {
  args: {
    id: "image-upload-uploading",
    photos: [
      { previewUrl: RED_DOT, name: "photo-1.png", status: "uploaded" },
      { previewUrl: BLUE_DOT, name: "just-added.png", status: "uploading" },
    ],
    onAdd: fn(),
    onRemove: fn(),
  },
}

export const UploadFailed: Story = {
  args: {
    id: "image-upload-failed",
    photos: [
      { previewUrl: RED_DOT, name: "photo-1.png", status: "uploaded" },
      { previewUrl: BLUE_DOT, name: "broke.png", status: "error" },
    ],
    onAdd: fn(),
    onRemove: fn(),
  },
}

export const NoPreview: Story = {
  args: {
    id: "image-upload-no-preview",
    photos: [
      { previewUrl: RED_DOT, name: "photo-1.png", status: "uploaded" },
      { previewUrl: "", name: "IMG_0001.heic", status: "uploaded", noPreview: true },
    ],
    onAdd: fn(),
    onRemove: fn(),
  },
}
