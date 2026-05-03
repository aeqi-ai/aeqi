//! Storage layer: SQLite via rusqlite, schema migrations, query helpers.

pub mod migrations {
    //! Additive-only SQL migrations. Each entity gets a numbered .sql file.
}

pub mod queries {
    //! Common upserts + counter operations.
}
