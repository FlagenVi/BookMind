package afoni.projectf.model;

public enum MaterialType {
    BOOK,
    DOCUMENT;

    public static MaterialType defaultFor(String format) {
        return "epub".equalsIgnoreCase(format) || "fb2".equalsIgnoreCase(format) ? BOOK : DOCUMENT;
    }

    public static MaterialType requestedOrDefault(String value, String format) {
        if ("epub".equalsIgnoreCase(format) || "fb2".equalsIgnoreCase(format)) return BOOK;
        if (value == null || value.isBlank()) return defaultFor(format);
        try { return valueOf(value.strip().toUpperCase(java.util.Locale.ROOT)); }
        catch (IllegalArgumentException error) { throw new IllegalArgumentException("Тип материала должен быть BOOK или DOCUMENT"); }
    }
}
