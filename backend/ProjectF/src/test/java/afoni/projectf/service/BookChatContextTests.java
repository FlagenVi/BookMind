package afoni.projectf.service;

import org.junit.jupiter.api.Test;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class BookChatContextTests {
    @Test void neverIncludesTextAfterSavedPosition() {
        String text="Начало книги и герой. ".repeat(200)+"СЕКРЕТ_ФИНАЛА";
        int confirmed=text.indexOf("СЕКРЕТ_ФИНАЛА");
        var selected=BookChatContext.select(text,confirmed,"Что делает герой?",
                List.of(new BookChatContext.Section(1,"Глава первая",0,text.length())));
        assertFalse(selected.text().contains("СЕКРЕТ_ФИНАЛА"));
        assertFalse(selected.references().isEmpty());
        assertTrue(selected.references().stream().allMatch(ref->ref.endOffset()<=confirmed));
        assertEquals(confirmed,selected.positionOffset());
    }

    @Test void reportsEmptySourceBeforeReadingAndKeepsExcerptCountBounded() {
        String text="Первая глава. ".repeat(2000);
        assertTrue(BookChatContext.select(text,0,"глава",List.of()).text().isEmpty());
        var selected=BookChatContext.select(text,text.length(),"глава",List.of());
        assertTrue(selected.references().size()<=6);
        assertTrue(selected.text().length()<15000);
    }

    @Test void selectedFragmentUsesExactTextAndIncludesImmediateSurroundings() {
        String text="До выделения. Важная цитата героя. После выделения.";
        int start=text.indexOf("Важная");
        int end=start+"Важная цитата героя.".length();
        var result=BookChatContext.selectedFragment(text,end,start,end,text.substring(start,end),
                List.of(new BookChatContext.Section(1,"Глава",0,text.length())));
        assertEquals(1,result.references().size());
        assertTrue(result.references().getFirst().endOffset()>end);
        assertTrue(result.text().contains("Выделенный пользователем фрагмент:\n<<<\nВажная цитата героя.\n>>>"));
        assertTrue(result.text().contains("Контекст после выделения:\n После выделения."));
        assertThrows(IllegalArgumentException.class,()->BookChatContext.selectedFragment(text,end,start,end,"Другой текст",List.of()));
    }
}
