<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="citation-picker"
      v-bind:aria-labelledby="headingId"
      v-on:cancel.prevent="emit('close')"
    >
      <header class="picker-header">
        <h2 v-bind:id="headingId">
          {{ trans('Insert citation') }}
        </h2>
        <button type="button" class="cancel" v-on:click="emit('close')">
          {{ trans('Cancel') }}
        </button>
      </header>

      <form class="picker-filters" v-on:submit.prevent="selectFirst" v-on:keydown="handleFilterKey">
        <label class="general-search">
          {{ trans('Search references') }}
          <input ref="searchInput" v-model="query.text" type="search">
        </label>
        <label>
          {{ trans('Author') }}
          <input v-model="query.author" type="search">
        </label>
        <label>
          {{ trans('Year') }}
          <input v-model="query.year" type="search">
        </label>
        <label>
          {{ trans('Title') }}
          <input v-model="query.title" type="search">
        </label>
      </form>

      <div
        ref="resultsList"
        class="picker-results"
        v-bind:aria-busy="props.loading"
        v-on:keydown="moveResultFocus"
      >
        <p v-if="props.loading" class="status" role="status">
          {{ trans('Loading references…') }}
        </p>
        <p v-else-if="props.error" class="status" role="status">
          {{ trans('Could not load the bibliography.') }}
        </p>
        <p v-else-if="results.length === 0" class="status" role="status">
          {{ props.citations.length === 0
            ? trans('No references are available in this bibliography.')
            : trans('No references match your search.') }}
        </p>
        <template v-else>
          <section v-for="group in groups" v-bind:key="group.label">
            <h3>{{ group.label }}</h3>
            <ul>
              <li v-for="result in group.items" v-bind:key="result.citekey">
                <button
                  type="button"
                  class="citation-result"
                  v-bind:tabindex="result === results[0] ? 0 : -1"
                  v-on:click="emit('select', result.citekey)"
                >
                  <strong>{{ result.title || trans('Untitled reference') }}</strong>
                  <span v-if="result.authors !== '' || result.year !== ''" class="reference-details">
                    {{ [ result.authors, result.year ].filter(Boolean).join(' · ') }}
                  </span>
                  <small class="citekey">{{ result.citekey }}</small>
                </button>
              </li>
            </ul>
          </section>
          <button
            v-if="visibleLimit < results.length"
            type="button"
            class="show-more"
            v-on:click="showMore"
          >
            {{ trans('Show more references') }}
          </button>
        </template>
      </div>
    </dialog>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, useId, watch } from 'vue'
import { trans } from '@common/i18n-renderer'
import { searchCitations, type CitationPickerResult } from './util/citation-picker'

const props = defineProps<{
  citations: readonly CitationPickerResult[]
  used: ReadonlySet<string>
  loading: boolean
  error: boolean
  initialQuery?: string
}>()

const emit = defineEmits<{
  (e: 'select', citekey: string): void
  (e: 'close'): void
}>()

const headingId = useId()
const dialog = ref<HTMLDialogElement|null>(null)
const searchInput = ref<HTMLInputElement|null>(null)
const resultsList = ref<HTMLDivElement|null>(null)
const query = reactive({ text: props.initialQuery ?? '', author: '', year: '', title: '' })
const pageSize = 100
const visibleLimit = ref(pageSize)

const results = computed(() => searchCitations(props.citations, query, props.used))
const groups = computed(() => {
  const visible = results.value.slice(0, visibleLimit.value)
  const cited = visible.filter(result => props.used.has(result.citekey))
  const other = visible.filter(result => !props.used.has(result.citekey))
  return [
    { label: trans('Cited in this workspace'), items: cited },
    { label: cited.length === 0 ? trans('References') : trans('Other references'), items: other }
  ].filter(group => group.items.length > 0)
})

onMounted(() => {
  dialog.value?.showModal()
  searchInput.value?.focus()
})

onBeforeUnmount(() => dialog.value?.close())

watch(query, () => {
  visibleLimit.value = pageSize
  resultsList.value?.scrollTo(0, 0)
})

function selectFirst (): void {
  const first = results.value[0]
  if (first !== undefined && !props.loading && !props.error) {
    emit('select', first.citekey)
  }
}

function handleFilterKey (event: KeyboardEvent): void {
  if (event.isComposing || event.key !== 'Enter') {
    moveResultFocus(event)
    return
  }

  event.preventDefault()
  selectFirst()
}

function resultButtons (): HTMLButtonElement[] {
  return Array.from(resultsList.value?.querySelectorAll<HTMLButtonElement>('.citation-result') ?? [])
}

function moveResultFocus (event: KeyboardEvent): void {
  if (event.isComposing || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) {
    return
  }

  const buttons = resultButtons()
  if (buttons.length === 0) {
    return
  }

  event.preventDefault()
  const index = buttons.findIndex(button => button === event.target)
  if (event.key === 'ArrowUp' && index === 0) {
    searchInput.value?.focus()
  } else {
    const next = event.key === 'ArrowDown' ? index + 1 : index === -1 ? buttons.length - 1 : index - 1
    buttons[Math.min(next, buttons.length - 1)]?.focus()
  }
}

async function showMore (): Promise<void> {
  const firstNew = visibleLimit.value
  visibleLimit.value += pageSize
  await nextTick()
  resultButtons()[firstNew]?.focus()
}
</script>

<style lang="css" scoped>
.citation-picker {
  --picker-surface: #ffffff;
  --picker-text: #21262b;
  --picker-muted: #495761;
  --picker-border: #d5dde2;
  --picker-hover: #eef4f8;
  --picker-focus: var(--system-accent-color, #236ca3);

  padding: 0;
  border: 1px solid var(--picker-border);
  border-radius: 10px;
  color: var(--picker-text);
  background: var(--picker-surface);
  box-shadow: 0 14px 48px #0004;
  inline-size: min(42rem, calc(100% - 2rem));
  block-size: min(39rem, calc(100% - 2rem));
  max-inline-size: none;
  max-block-size: none;
}

body.dark .citation-picker {
  --picker-surface: #232629;
  --picker-text: #f0f2f4;
  --picker-muted: #c3cbd1;
  --picker-border: #495057;
  --picker-hover: #313e47;
  --picker-focus: var(--system-accent-color, #8ec7f1);
  color-scheme: dark;
}

.citation-picker[open] {
  display: flex;
  flex-direction: column;
}

.citation-picker::backdrop {
  background: #10182066;
}

.picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.25rem 0.75rem;
}

.picker-header h2 {
  margin: 0;
  font-size: 1.2rem;
}

.picker-filters {
  display: grid;
  grid-template-columns: 1fr minmax(5rem, 0.45fr) 1.35fr;
  gap: 0.7rem;
  padding: 0 1.25rem 1rem;
  border-bottom: 1px solid var(--picker-border);
}

.picker-filters label {
  display: grid;
  gap: 0.3rem;
  min-inline-size: 0;
  font-size: 0.9rem;
}

.picker-filters input {
  box-sizing: border-box;
  inline-size: 100%;
  min-inline-size: 0;
  font: inherit;
  color: inherit;
  background: var(--picker-surface);
  border: 1px solid var(--picker-border);
  border-radius: 5px;
  padding: 0.45rem 0.55rem;
}

.general-search {
  grid-column: 1 / -1;
}

.picker-results {
  flex: 1;
  overflow: auto;
  padding: 0.5rem 0.75rem 0.75rem;
}

.picker-results h3 {
  margin: 0.55rem 0.5rem 0.25rem;
  font-size: 0.9rem;
  color: var(--picker-muted);
}

.picker-results ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

.citation-result {
  display: grid;
  gap: 0.22rem;
  inline-size: 100%;
  padding: 0.55rem 0.5rem;
  border: 0;
  border-radius: 5px;
  color: inherit;
  background: transparent;
  font: inherit;
  text-align: start;
  overflow-wrap: anywhere;
}

.citation-result:hover,
.citation-result:focus-visible,
.cancel:hover,
.show-more:hover {
  background: var(--picker-hover);
}

.reference-details,
.citekey,
.status {
  color: var(--picker-muted);
}

.citekey {
  font-family: monospace;
}

.status {
  margin: 0.75rem 0.5rem;
}

.cancel,
.show-more {
  border: 1px solid var(--picker-border);
  border-radius: 5px;
  color: inherit;
  background: var(--picker-surface);
  padding: 0.4rem 0.65rem;
  font: inherit;
}

.show-more {
  margin: 0.5rem;
}

.citation-picker :is(input, button):focus-visible {
  outline: 2px solid var(--picker-focus);
  outline-offset: -2px;
}
</style>
