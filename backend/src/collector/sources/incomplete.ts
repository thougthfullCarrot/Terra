import type { RawJob } from '../../types.js';

/**
 * A board that answered but could not be read in full: a page deep in the
 * list failed, a detail request failed, or the board lists more than it will
 * page through. The jobs that were read are real and publish as usual; what
 * the board did not give this pass is unknown, not closed, so the run must
 * not treat it as taken down.
 */
export class IncompleteBoardError extends Error {
  constructor(
    message: string,
    readonly jobs: RawJob[]
  ) {
    super(message);
    this.name = 'IncompleteBoardError';
  }
}

/**
 * For checks that read a board on purpose only in part (verify-firms caps
 * Workday at two pages): the jobs read, without the incompleteness error.
 */
export async function evenIfIncomplete(read: Promise<RawJob[]>): Promise<RawJob[]> {
  try {
    return await read;
  } catch (error) {
    if (error instanceof IncompleteBoardError) return error.jobs;
    throw error;
  }
}
