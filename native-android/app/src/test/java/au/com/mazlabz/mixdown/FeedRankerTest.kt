package au.com.mazlabz.mixdown

import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class FeedRankerTest {
    private fun item(id: String, kind: String, bucket: String = "entertainment") = FeedItem(
        id, kind, "Title " + id, "", "", bucket,
        if (kind == "video") "https://example.org/" + id + ".mp4" else "",
        if (kind == "video") "mp4" else "",
        "", "", emptyList(), "", "2026-10-20T01:00:00Z", 0.7, 0.6, 0.8, false
    )

    @Test fun paginationAdvancesByRawServerRowsEvenAfterFiltering() {
        val filtered = FeedBatch(listOf(item("valid", "video")), received = 45)
        assertEquals(90, filtered.nextOffset(45))
        assertEquals(45, filtered.received)
        assertEquals(1, filtered.items.size)
        assertEquals(45, FeedBatch(emptyList(), received = 45).nextOffset(0))
        assertEquals(45, FeedBatch(emptyList(), received = 0).nextOffset(45))
    }

    @Test fun rssMetadataIsReadableNotXml() {
        assertEquals("Tom Warren", FeedText.plain("<name>Tom Warren</name>"))
        assertEquals("Rock & Roll", FeedText.plain("Rock &amp; Roll"))
        assertEquals("Tom Warren", FeedText.plain("&lt;name&gt;Tom Warren&lt;/name&gt;"))
        assertEquals("Xbox's news", FeedText.plain("Xbox&#39;s news"))
    }

    @Test fun noDuplicatesInMixedFeed() {
        val items = listOf(item("v1", "video"), item("v1", "video"), item("a1", "article"))
        assertEquals(2, FeedRanker.rank(items, Taste(), FeedFilter.ALL).size)
    }

    @Test fun videosAreActuallyPlayable() {
        val broken = item("v1", "video").copy(mediaUrl = "")
        val valid = item("v2", "video")
        assertEquals(listOf("v2"), FeedRanker.rank(listOf(broken, valid), Taste(), FeedFilter.VIDEOS).map { it.id })
    }

    @Test fun mixedFeedDoesNotCollapseToOnlyArticles() {
        val articles = (0..30).map { item("a" + it, "article") }
        val videos = (0..10).map { item("v" + it, "video") }
        val feed = FeedRanker.rank(articles + videos, Taste(), FeedFilter.ALL)
        assertTrue(feed.take(8).count { it.kind == "video" } >= 3)
        assertTrue(feed.take(8).count { it.kind == "article" } >= 1)
    }

    @Test fun interestWeightsAffectOrdering() {
        val tech = item("tech", "article", "software-depth")
        val play = item("play", "article", "entertainment")
        val taste = Taste(tech = 1.0f, entertainment = 0f, comedy = 0f, shorts = 0f)
        assertEquals("tech", FeedRanker.rank(listOf(play, tech), taste, FeedFilter.ARTICLES).first().id)
    }

    @Test fun theMainFeedContainsOnlyPlayableVideosAndReadableArticles() {
        assertFalse(FeedFilter.ALL.accepts(item("s", "social")))
        assertFalse(FeedFilter.ALL.accepts(item("v", "video").copy(mediaUrl = "")))
        assertTrue(FeedFilter.ALL.accepts(item("v", "video")))
        assertTrue(FeedFilter.ARTICLES.accepts(item("a", "article")))
        assertFalse(FeedFilter.ARTICLES.accepts(item("v", "video")))
        assertEquals(listOf("For you", "Videos", "Headlines"),
            FeedFilter.entries.map { it.title })
    }

    @Test fun publicationDateWinsOverRecentIngestionForArticles() {
        val archive = item("old", "article").copy(
            publishedAt = "2020-10-08T20:50:55Z",
            ingestedAt = "2026-10-23T18:30:08Z")
        val actualRecent = item("fresh", "article").copy(
            publishedAt = "2026-10-23T20:50:55Z",
            ingestedAt = "2026-10-20T18:30:08Z")
        val ranked = FeedRanker.rank(listOf(archive, actualRecent),
            Taste(), FeedFilter.ARTICLES)
        assertEquals("fresh", ranked.first().id)
    }
    @Test fun socialFreshnessIsExplicitlyBounded() {
        val now = Instant.parse("2026-10-24T00:00:00Z")
        val recent = item("recent", "social").copy(ingestedAt = "2026-10-23T00:00:00Z")
        val stale = item("stale", "social").copy(ingestedAt = "2026-09-30T00:00:00Z")
        assertTrue(FeedRanker.isFreshSocial(recent, now))
        assertFalse(FeedRanker.isFreshSocial(stale, now))
        assertFalse(FeedRanker.isFreshSocial(stale.copy(ingestedAt = "not-a-date"), now))
    }

    @Test fun alternatePublishersWhenPossible() {
        val input = listOf(
            item("one", "article").copy(permalink = "https://alpha.test/one"),
            item("two", "article").copy(permalink = "https://alpha.test/two"),
            item("three", "article").copy(permalink = "https://beta.test/three"),
            item("four", "article").copy(permalink = "https://alpha.test/four")
        )
        val ranked = FeedRanker.diversifySources(input)
        assertEquals(listOf("one", "three", "two", "four"), ranked.map { it.id })
    }

    @Test fun onePublisherDoesNotDropItems() {
        val input = (1..5).map {
            item("story" + it, "article").copy(permalink = "https://alpha.test/" + it)
        }
        assertEquals(input.map { it.id }, FeedRanker.diversifySources(input).map { it.id })
    }

}
