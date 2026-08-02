import { useState } from 'react'

import { BookGrid } from '../book-grid'
import { LibraryEmptyState } from '../library-empty-state'
import { LibraryFilterBar } from '../library-filter-bar'
import { LibrarySidePanel } from '../library-side-panel'
import { LibraryTopBar } from '../library-top-bar'
import { LibraryUploadPanel } from '../library-upload-panel'
import { libraryCopy, librarySortItems, libraryStatusFilterItems } from '../../library-config'
import type { LibraryBook, LibrarySortKey, LibraryStatusFilterKey } from '../../types'

type LibraryHomePageProps = {
  books: LibraryBook[]
  selectedBookId?: string
  searchValue: string
  sortKey: LibrarySortKey
  statusFilterKey: LibraryStatusFilterKey
  selectionMode?: boolean
  selectedBookIds?: Set<string>
  onSelectBook?: (book: LibraryBook) => void
  onOpenReader?: (book: LibraryBook) => void
  onDeleteBook?: (book: LibraryBook) => void
  onToggleSelectBook?: (book: LibraryBook) => void
  onSearchChange?: (value: string) => void
  onSelectSort?: (key: LibrarySortKey) => void
  onSelectStatus?: (key: LibraryStatusFilterKey) => void
  onOpenSettings?: () => void
  onToggleSelectionMode?: () => void
  onDeleteSelectedBooks?: () => void
  onClearSelection?: () => void
}

export function LibraryHomePage({
  books,
  selectedBookId,
  searchValue,
  sortKey,
  statusFilterKey,
  selectionMode = false,
  selectedBookIds = new Set(),
  onSelectBook,
  onOpenReader,
  onDeleteBook,
  onToggleSelectBook,
  onSearchChange,
  onSelectSort,
  onSelectStatus,
  onOpenSettings,
  onToggleSelectionMode,
  onDeleteSelectedBooks,
  onClearSelection,
}: LibraryHomePageProps) {
  const [sidePanelExpanded, setSidePanelExpanded] = useState(false)

  return (
    <div className="mx-auto grid h-full w-full max-w-[1180px] grid-rows-[auto_minmax(0,1fr)] gap-5">
      <LibraryTopBar
        appName={libraryCopy.topBar.appName}
        searchValue={searchValue}
        searchPlaceholder={libraryCopy.topBar.searchPlaceholder}
        settingsLabel={libraryCopy.topBar.settingsLabel}
        onSearchChange={onSearchChange}
        onOpenSettings={onOpenSettings}
      />

      <section className="relative grid min-h-0 grid-cols-[minmax(0,1fr)]">
        <div className="col-span-full">
          <LibraryUploadPanel />
        </div>
        <LibrarySidePanel
          expanded={sidePanelExpanded}
          items={libraryCopy.sidePanel.items}
          selectionMode={selectionMode}
          selectedCount={selectedBookIds.size}
          onToggle={() => setSidePanelExpanded((expanded) => !expanded)}
          onSelectItem={(key) => {
            if (key === 'selection') {
              onToggleSelectionMode?.()
            }
          }}
          onDeleteSelected={onDeleteSelectedBooks}
          onClearSelection={onClearSelection}
        />
        <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
          <LibraryFilterBar
            items={librarySortItems}
            selectedKey={sortKey}
            statusItems={libraryStatusFilterItems}
            selectedStatusKey={statusFilterKey}
            onSelect={onSelectSort}
            onSelectStatus={onSelectStatus}
          />
          {books.length > 0 ? (
            <BookGrid
              books={books}
              selectedBookId={selectedBookId}
              selectionMode={selectionMode}
              selectedBookIds={selectedBookIds}
              onSelectBook={onSelectBook}
              onToggleSelectBook={onToggleSelectBook}
              onOpenReader={onOpenReader}
              onDeleteBook={onDeleteBook}
            />
          ) : (
            <LibraryEmptyState />
          )}
        </div>
      </section>
    </div>
  )
}
