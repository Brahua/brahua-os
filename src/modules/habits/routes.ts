// URLs of the habits screens. Client-safe.

export const HABITS_PATH = "/habits";

/** A habit's page (H5: the detail with its calendar). `today` links to it (H6). */
export const habitPath = (id: string) => `${HABITS_PATH}/${id}`;
