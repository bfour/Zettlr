<template>
  <div id="sidebar-comments" role="tabpanel" v-bind:aria-label="trans('Comments')">
    <h1>{{ trans('Comments') }}</h1>
    <p v-if="comments.length === 0">
      {{ trans('No comments in this document.') }}
    </p>
    <ul v-else class="comment-list">
      <li v-for="comment in comments" v-bind:key="comment.from">
        <button type="button" v-on:click="activeEntry?.selectComment(comment)">
          <span class="comment-location">{{ trans('Line %s', String(comment.line)) }}</span>
          <span class="comment-text">{{ comment.text || trans('Empty comment') }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { trans } from '@common/i18n-renderer'
import { computed } from 'vue'
import { useDocumentTreeStore, useWindowStateStore } from 'source/pinia'

const documentTreeStore = useDocumentTreeStore()
const windowStateStore = useWindowStateStore()

const activeEntry = computed(() => {
  const { lastLeafId, lastLeafActiveFile } = documentTreeStore
  const entry = lastLeafId === undefined ? undefined : windowStateStore.commentsByLeaf.get(lastLeafId)
  return entry?.path === lastLeafActiveFile?.path ? entry : undefined
})
const comments = computed(() => activeEntry.value?.comments ?? [])
</script>

<style scoped>
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
