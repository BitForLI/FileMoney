/// <reference types="vite/client" />

import type { WorkspaceApi } from '../../shared/types'

declare global {
  interface Window {
    pagefold: WorkspaceApi
  }
}

export {}
