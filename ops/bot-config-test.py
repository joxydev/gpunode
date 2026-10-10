"""Bot settings fixtures; never contact a real Telegram bot."""
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('bot_config', pathlib.Path(__file__).with_name('bot-config.py'))
config = importlib.util.module_from_spec(spec)
spec.loader.exec_module(config)
ENV = {'PUBLIC_URL': 'https://example.invalid/', 'BOT_USERNAME': 'aethermind_ci_bot', 'BOT_WEBHOOK_SECRET': 'TEST_NOT_REAL'}


class FakeTelegram:
    def __init__(self, main=False, webhook='', wrong_menu=False):
        self.main, self.webhook, self.wrong_menu = main, webhook, wrong_menu
        self.calls, self.values = [], {}
    def __call__(self, method, payload):
        self.calls.append((method, payload))
        if method == 'getMe':
            return {'username': ENV['BOT_USERNAME'], 'has_main_web_app': self.main}
        if method == 'getWebhookInfo':
            return {'url': self.webhook, 'allowed_updates': ['message', 'callback_query']}
        if method == 'setWebhook':
            self.webhook = payload['url']
            return True
        if method == 'setChatMenuButton':
            self.values['menu'] = payload['menu_button']
            return True
        if method == 'getChatMenuButton':
            return {} if self.wrong_menu else self.values['menu']
        for suffix, key in [('MyCommands', 'commands'), ('MyDescription', 'description'), ('MyShortDescription', 'short_description')]:
            slot = suffix, payload.get('language_code', '')
            if method == 'set' + suffix:
                self.values[slot] = payload[key]
                return True
            if method == 'get' + suffix:
                return self.values[slot] if key == 'commands' else {key: self.values[slot]}
        raise AssertionError(method)


class BotConfigTests(unittest.TestCase):
    def test_configures_and_reads_back_all_languages_without_sending_messages(self):
        for main in (False, True):
            fake = FakeTelegram(main)
            bot, url = config.configure(ENV, fake)
            self.assertEqual(bot['has_main_web_app'], main)
            self.assertEqual(url, 'https://example.invalid')
            self.assertEqual({p.get('language_code', '') for m, p in fake.calls if m == 'setMyCommands'}, {'', 'ru', 'en', 'ro'})
            self.assertFalse(any(m.startswith('send') for m, _ in fake.calls))
            self.assertFalse(next(p for m, p in fake.calls if m == 'setWebhook')['drop_pending_updates'])

    def test_different_webhook_stops_before_any_mutation(self):
        fake = FakeTelegram(webhook='https://other.invalid/webhook')
        with self.assertRaisesRegex(ValueError, 'другой webhook'):
            config.configure(ENV, fake)
        self.assertTrue(all(m.startswith('get') for m, _ in fake.calls))

    def test_failed_readback_is_reported(self):
        with self.assertRaisesRegex(ValueError, 'кнопку меню'):
            config.configure(ENV, FakeTelegram(wrong_menu=True))

    def test_metadata_respects_telegram_limits(self):
        for copy in config.COPY.values():
            self.assertLessEqual(len(copy['description']), 512)
            self.assertLessEqual(len(copy['short']), 120)
            self.assertTrue(all(1 <= len(d) <= 256 for _, d in copy['commands']))

    def test_invalid_url_is_rejected_before_contacting_telegram(self):
        for url in ('http://example.invalid', 'https://example.invalid/?x=1', 'https://user:pass@example.invalid', 'https://example.invalid/path'):
            fake = FakeTelegram()
            with self.assertRaises(ValueError):
                config.configure({**ENV, 'PUBLIC_URL': url}, fake)
            self.assertEqual(fake.calls, [])


if __name__ == '__main__':
    unittest.main()
