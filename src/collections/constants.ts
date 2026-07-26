/**
 * Filesystem layout conventions for first-class collections.
 * Domain and discovery code share these strings; VS Code adapters must not
 * hard-code alternate spellings.
 */

/** Default directory under each workspace folder that holds collections. */
export const COLLECTIONS_DIRECTORY_NAME = 'Collections';

/** Marker filename at each collection root (`Collections/<Name>/`). */
export const COLLECTION_MARKER_FILENAME = 'api-hero.collection.json';

/** Non-sensitive collection variables filename at each collection root. */
export const COLLECTION_VARIABLES_FILENAME = 'api-hero.variables.json';

/** Display label for the synthetic collection of out-of-layout `.api` files. */
export const LEGACY_COLLECTION_LABEL = 'Legacy';
