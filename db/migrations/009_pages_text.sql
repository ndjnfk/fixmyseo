-- v2: keep a bounded text excerpt per page for content scoring and internal-link suggestions
ALTER TABLE pages ADD COLUMN text_excerpt MEDIUMTEXT NULL;
ALTER TABLE pages ADD COLUMN h2s_json JSON NULL;
ALTER TABLE pages ADD COLUMN internal_links_out INT NULL;
ALTER TABLE pages ADD COLUMN redirected_to VARCHAR(1000) NULL;
