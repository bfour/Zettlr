<template>
  <div id="sidebar-comments" role="tabpanel" v-bind:aria-label="trans('Comments')">
    <h1>{{ trans('Comments') }}</h1>
    <form v-if="draft !== undefined" class="comment-draft" v-on:submit.prevent="saveDraft">
      <blockquote>{{ draft.quote }}</blockquote>
      <label>
        {{ trans('New comment') }}
        <textarea v-model="draftText" v-focus rows="3"></textarea>
      </label>
      <p v-if="draftFailed" role="alert">
        {{ trans('Could not add the comment. Check the document and select the text again.') }}
      </p>
      <div class="comment-draft-actions">
        <button type="submit" v-bind:disabled="draftText.trim() === ''">
          {{ trans('Add comment') }}
        </button>
        <button type="button" v-on:click="closeDraft">
          {{ trans('Cancel') }}
        </button>
      </div>
    </form>
    <p v-if="comments.length === 0 && draft === undefined">
      {{ trans('No comments in this document.') }}
    </p>
    <ul v-if="comments.length > 0" class="comment-list">
      <li v-for="comment in comments" v-bind:key="comment.from">
        <button
          type="button"
          v-bind:disabled="comment.annotation === true && comment.anchor === undefined"
          v-on:click="activeEntry?.selectComment(comment)"
        >
          <span class="comment-location">
            {{ comment.annotation === true && comment.anchor === undefined
              ? trans('Text anchor unavailable')
              : trans('Line %s', String(comment.line)) }}
          </span>
          <span class="comment-text">{{ comment.text || trans('Empty comment') }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { trans } from '@common/i18n-renderer'
import { computed, ref, watch } from 'vue'
import { useDocumentTreeStore, useWindowStateStore } from 'source/pinia'

const documentTreeStore = useDocumentTreeStore()
const windowStateStore = useWindowStateStore()

const activeEntry = computed(() => {
  const { lastLeafId, lastLeafActiveFile } = documentTreeStore
  const entry = lastLeafId === undefined ? undefined : windowStateStore.commentsByLeaf.get(lastLeafId)
  return entry?.path === lastLeafActiveFile?.path ? entry : undefined
})
const comments = computed(() => activeEntry.value?.comments ?? [])
const draft = computed(() => {
  const pending = windowStateStore.commentDraft
  return pending?.leafId === documentTreeStore.lastLeafId && pending?.path === activeEntry.value?.path
    ? pending
    : undefined
})
const draftText = ref('')
const draftFailed = ref(false)
watch(() => windowStateStore.commentDraft, () => {
  draftText.value = ''
  draftFailed.value = false
})

function closeDraft (): void {
  windowStateStore.commentDraft = undefined
}

function saveDraft (): void {
  const text = draftText.value.trim()
  if (text === '' || draft.value === undefined) {
    return
  }
  if (draft.value.submit(text)) {
    closeDraft()
  } else {
    draftFailed.value = true
  }
}
</script>

<style scoped>
.comment-draft {
  display: grid;
  gap: 8px;
}

.comment-draft blockquote {
  margin: 0;
  padding-inline-start: 8px;
  border-inline-start: 2px solid currentColor;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 5em;
  overflow: auto;
}

.comment-draft textarea {
  display: block;
  box-sizing: border-box;
  width: 100%;
  resize: vertical;
}

.comment-draft-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.comment-list {
  display: grid;
  gap: 8px;
  padding: 0;
  list-style: none;
}

.comment-list button {
  display: grid;
  gap: 4px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid currentColor;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: start;
  cursor: pointer;
}

.comment-list button:hover {
  background: color-mix(in srgb, currentColor 8%, transparent);
}

.comment-location {
  font-size: 0.85em;
}

.comment-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
