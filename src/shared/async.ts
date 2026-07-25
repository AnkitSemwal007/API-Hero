/**

 * Starts a promise without awaiting it, routing rejections to {@link onError}

 * so background work cannot become an unhandled rejection.

 *

 * If {@link onError} throws or returns a rejecting promise, that failure is

 * swallowed so the error reporter itself cannot create a new unhandled rejection.

 */

export function fireAndForget(

  task: Promise<unknown>,

  onError: (error: unknown) => void | PromiseLike<void>,

): void {

  void task.then(undefined, (error: unknown) => {

    let reported: void | PromiseLike<void>;

    try {

      reported = onError(error);

    } catch {

      return;

    }

    if (

      reported !== undefined &&

      reported !== null &&

      typeof (reported as PromiseLike<void>).then === 'function'

    ) {

      void Promise.resolve(reported).then(undefined, () => {

        // Error-reporter failures must not become unhandled rejections.

      });

    }

  });

}


