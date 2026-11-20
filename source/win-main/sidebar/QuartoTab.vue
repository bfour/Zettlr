<template>
  <div id="sidebar-quarto" role="tabpanel" v-bind:aria-label="trans('Quarto project')">
    <h1>{{ props.project.title || trans('Quarto project') }}</h1>
    <button
      type="button"
      class="render-book"
      v-bind:disabled="props.rendering || !props.project.canRender"
      v-bind:aria-busy="props.rendering"
      v-on:click="emit('render')"
    >
      {{ props.rendering ? trans('Rendering book…') : trans('Render book') }}
    </button>
    <p v-if="!props.project.canRender" class="quarto-detail">
      {{ trans('Quarto is unavailable.') }}
    </p>

    <section>
      <h2>{{ trans('Chapters') }}</h2>
      <p v-if="props.project.chapters.length === 0">
        {{ trans('No chapters are configured.') }}
      </p>
      <ol v-else class="quarto-list">
        <li v-for="(chapter, index) in props.project.chapters" v-bind:key="index">
          <h3 v-if="chapterGroup(index) !== undefined">
            {{ chapterGroup(index) }}
          </h3>
          <button
            type="button"
            class="quarto-link"
            v-bind:aria-current="chapter.path === props.activePath ? 'page' : undefined"
            v-on:click="emit('open-file', chapter.path)"
          >
            <span>{{ chapter.title || chapterPath(chapter.path) }}</span>
            <small v-if="chapter.title" class="quarto-detail">{{ chapterPath(chapter.path) }}</small>
          </button>
        </li>
      </ol>
    </section>

    <section>
      <h2>{{ trans('Cross-references') }}</h2>
      <p v-if="(props.project.unreadableChapters?.length ?? 0) > 0">
        {{ trans('Some chapters could not be read.') }}
      </p>
      <p v-else-if="issueGroups.length === 0">
        {{ trans('No cross-reference issues.') }}
      </p>
      <template v-for="group in issueGroups" v-bind:key="group.marker">
        <h3>{{ group.label }}</h3>
        <ul class="quarto-list">
          <li
            v-for="(issue, index) in group.items"
            v-bind:key="`${issue.path}:${issue.line}:${issue.id}:${index}`"
          >
            <button
              type="button"
              class="quarto-link"
              v-on:click="emit('jump-to-line', issue.path, issue.line)"
            >
              <code>{{ group.marker }}{{ issue.id }}</code>
              <small class="quarto-detail">{{ sourceLocation(issue.path, issue.line) }}</small>
            </button>
          </li>
        </ul>
      </template>
      <details v-if="props.project.sections.targets.length > 0">
        <summary>{{ trans('Section targets') }}</summary>
        <ul class="quarto-list">
          <li
            v-for="target in props.project.sections.targets"
            v-bind:key="`${target.path}:${target.line}:${target.id}`"
          >
            <button
              type="button"
              class="quarto-link"
              v-on:click="emit('jump-to-line', target.path, target.line)"
            >
              <span>{{ target.title || target.id }}</span>
              <small class="quarto-detail">{{ sourceLocation(target.path, target.line) }}</small>
            </button>
          </li>
        </ul>
      </details>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { trans } from '@common/i18n-renderer'
import { relativePath } from '@common/util/renderer-path-polyfill'
import type { QuartoProjectInfo } from '@common/quarto/project-info'

const props = defineProps<{
  project: QuartoProjectInfo
  rendering: boolean
  activePath?: string
}>()

const emit = defineEmits<{
  (e: 'open-file', path: string): void
  (e: 'jump-to-line', path: string, line: number): void
  (e: 'render'): void
}>()

const issueGroups = computed(() => {
  const { duplicateIds, targets, unresolved } = props.project.sections
  const duplicates = new Set(duplicateIds)
  return [
    { label: trans('Unresolved references'), marker: '@', items: unresolved },
    { label: trans('Duplicate section IDs'), marker: '#', items: targets.filter(target => duplicates.has(target.id)) }
  ].filter(group => group.items.length > 0)
})

function chapterGroup (index: number): string|undefined {
  const { chapters } = props.project
  const chapter = chapters[index]
  const previous = chapters[index - 1]
  if (chapter.part !== undefined && (chapter.part !== previous?.part || chapter.appendix !== previous?.appendix)) {
    return chapter.part
  }
  if (chapter.appendix === true && previous?.appendix !== true) {
    return trans('Appendices')
  }
  return undefined
}

function chapterPath (path: string): string {
  const root = props.project.root
  // A filesystem root already ends with its separator.
  if (/[\\/]$/.test(root) && path.startsWith(root)) {
    return path.slice(root.length)
  }
  return relativePath(root, path)
}

function sourceLocation (path: string, line: number): string {
  return trans('%s, line %s', chapterPath(path), String(line))
}
</script>

<style scoped>
#sidebar-quarto {
  overflow-wrap: anywhere;
}

#sidebar-quarto section {
  margin-block: 16px;
}

#sidebar-quarto h2 {
  margin-block: 0 6px;
  font-size: 0.95rem;
}

#sidebar-quarto h3 {
  margin-block: 9px 4px;
  font-size: 0.85rem;
}

.render-book,
.quarto-link {
  color: inherit;
  background: transparent;
  font: inherit;
  border-radius: 5px;
}

.render-book {
  padding: 4px 8px;
  border: 1px solid currentColor;
}

.render-book:disabled {
  opacity: 0.6;
}

.quarto-list {
  padding: 0;
  margin: 0;
  list-style: none;
}

.quarto-link {
  display: grid;
  gap: 2px;
  width: 100%;
  padding: 4px 6px;
  border: 0;
  text-align: start;
}

.quarto-link:hover,
.quarto-link[aria-current="page"],
.render-book:hover:not(:disabled) {
  background: color-mix(in srgb, currentColor 9%, transparent);
}

.quarto-link,
.render-book:not(:disabled),
#sidebar-quarto summary {
  cursor: pointer;
}

.quarto-detail {
  font-size: 0.8em;
  opacity: 0.8;
}

#sidebar-quarto details {
  margin-block-start: 8px;
}
</style>
