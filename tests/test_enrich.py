import unittest

from app.utils.enrich import parse_ref, serialize_ref


class ParseRefTests(unittest.TestCase):
    def test_query_string_populates_utm(self):
        result = parse_ref(None, "utm_source=twitter&utm_medium=social")
        self.assertIsNone(result["host"])
        self.assertEqual(result["utm"]["source"], "twitter")
        self.assertEqual(result["utm"]["medium"], "social")
        self.assertIsNone(result["utm"]["campaign"])

    def test_header_sets_host_and_fills_missing_utm(self):
        header = "https://example.com/path?utm_source=ref&utm_term=widgets"
        result = parse_ref(header, "")
        self.assertEqual(result["host"], "example.com")
        self.assertEqual(result["utm"]["source"], "ref")
        self.assertEqual(result["utm"]["term"], "widgets")

    def test_request_query_takes_precedence_over_header(self):
        header = "https://example.com/page?utm_source=ref"
        result = parse_ref(header, "utm_source=campaign")
        self.assertEqual(result["utm"]["source"], "campaign")

    def test_bare_host_header(self):
        result = parse_ref("blog.example.co.uk/post", "")
        self.assertEqual(result["host"], "blog.example.co.uk")


class SerializeRefTests(unittest.TestCase):
    def test_host_and_utm_serialization(self):
        value = serialize_ref(
            host="Example.COM",
            utm={"source": "twitter", "medium": "social", "campaign": None, "term": None, "content": None},
        )
        self.assertEqual(value, "example.com?utm_source=twitter&utm_medium=social")

    def test_query_only_serialization(self):
        value = serialize_ref(None, {"source": "twitter", "medium": None, "campaign": None, "term": None, "content": None})
        self.assertEqual(value, "?utm_source=twitter")

    def test_fallback_when_no_data(self):
        value = serialize_ref(None, {"source": None, "medium": None, "campaign": None, "term": None, "content": None}, fallback="  https://ref.example/path  ")
        self.assertEqual(value, "https://ref.example/path")

    def test_empty_result_returns_none(self):
        value = serialize_ref(None, {"source": None, "medium": None, "campaign": None, "term": None, "content": None})
        self.assertIsNone(value)


if __name__ == "__main__":
    unittest.main()
