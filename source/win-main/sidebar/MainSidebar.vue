<template>
  <div id="sidebar">
    <div style="padding: 10px 20px 0px 20px">
      <TabBar
        v-bind:tabs="tabs"
        v-bind:current-tab="currentTab"
        v-on:tab="setCurrentTab($event)"
      ></TabBar>
    </div>

    <!-- Now the tab containers -->
    <div id="sidebar-tab-container">
      <ToCTab
        v-show="currentTab === 'toc'"
        v-on:move-section="emit('move-section', $event)"
        v-on:jump-to-line="emit('jump-to-line', $event)"
      ></ToCTab>
      <CommentsTab v-show="currentTab === 'comments'"></CommentsTab>
      <QuartoTab
        v-if="quartoProject !== undefined"
        v-show="currentTab === 'quarto'"
        v-bind:project="quartoProject"
        v-bind:active-path="props.activePath"
        v-bind:rendering="props.quartoRendering"
        v-on:open-file="emit('quarto-open', $event, 1)"
        v-on:jump-to-line="(path, line) => emit('quarto-open', path, line)"
        v-on:render="emit('quarto-render')"
      ></QuartoTab>
      <ReferencesTab v-show="currentTab === 'references'"></ReferencesTab>
      <RelatedFilesTab v-show="currentTab === 'relatedFiles'"></RelatedFilesTab>
      <OtherFilesTab v-show="currentTab === 'attachments'"></OtherFilesTab>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        Sidebar
 * CVM-Role:        View
 * Maintainer:      Hendrik Erz
 * License:         GNU GPL v3
 *
 * Description:     This component renders the sidebar.
 *
 * END HEADER
 */

import { trans } from '@common/i18n-renderer'
import TabBar from '@common/vue/TabBar.vue'
import { computed } from 'vue'
import CommentsTab from './CommentsTab.vue'
import ToCTab from './ToCTab.vue'
import ReferencesTab from './ReferencesTab.vue'
import RelatedFilesTab from './RelatedFilesTab.vue'
import QuartoTab from './QuartoTab.vue'
import OtherFilesTab from './OtherFilesTab.vue'
import { useConfigStore, useWindowStateStore } from 'source/pinia'

const configStore = useConfigStore()
const windowStateStore = useWindowStateStore()
const props = defineProps<{ activePath?: string, quartoRendering: boolean }>()
const quartoProject = computed(() => windowStateStore.quartoProject)

const emit = defineEmits<{
  (e: 'move-section', data: { from: number, to: number }): void
  (e: 'jump-to-line', line: number): void
  (e: 'quarto-open', path: string, line: number): void
  (e: 'quarto-render'): void
}>()

const currentTab = computed(() => {
  const tab = configStore.config.window.currentSidebarTab
  return tab === 'quarto' && quartoProject.value === undefined ? 'toc' : tab
})

const tabs = computed(() => [
  {
    icon: 'indent',
    id: 'toc',
    target: 'sidebar-toc',
    label: trans('Table of contents')
  },
  {
    icon: 'chat-bubble',
    id: 'comments',
    target: 'sidebar-comments',
    label: trans('Comments')
  },
  {
    icon: 'book',
    id: 'references',
    target: 'sidebar-bibliography',
    label: trans('References')
  },
  ...(quartoProject.value === undefined ? [] : [{
    icon: 'book',
    id: 'quarto',
    target: 'sidebar-quarto',
    label: trans('Quarto book')
  }]),
  {
    icon: 'file-group',
    id: 'relatedFiles',
    target: 'sidebar-related-files',
    label: trans('Related files')
  },
  {
    icon: 'paperclip',
    id: 'attachments',
    target: 'sidebar-files',
    label: trans('Other files')
  }
])

function setCurrentTab (which: string): void {
  configStore.setConfigValue('window.currentSidebarTab', which)
}
</script>

<style lang="less">
body {
  @button-margin: 5px;
  @border-radius: 5px;
  @button-size: 5px;
  @button-icon-size: 5px;

  #sidebar {
    background-color: transparent;
    height: 100%;
    width: 100%;
    overflow: hidden;
    display: flex;
    flex-direction: column;

    #sidebar-tab-container {
      padding: 10px;
      overflow-y: auto;
    }

    #open-dir-external {
      padding: @button-margin;
      border-radius: @border-radius;
      display: inline-block;
      width: @button-size;
      height: @button-size;

      clr-icon {
        width: @button-icon-size;
        height: @button-icon-size;
      }
    }

    h1 {
      font-size: 16px;
      margin: 10px 0;
    }
  }

  &.dark {
    #sidebar {
      background-color: rgba(30, 30, 30, 1);
      color: rgb(230, 230, 230);

      div.related-files-container div.related-file:hover {
        background-color: rgb(80, 80, 80);
      }
    }
  }
}
</style>
