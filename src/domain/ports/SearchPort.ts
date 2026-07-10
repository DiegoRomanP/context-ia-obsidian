export interface SearchHit {
  readonly title: string;
  readonly url: string;
  readonly content: string;
}

export interface SearchPort {
  search(query: string, maxResults: number): Promise<readonly SearchHit[]>;
}
