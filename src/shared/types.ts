export interface Warning {
  code: string;
  message: string;
}

export type WriteResult<T> = {
  result: T;
  warnings: Warning[];
};
