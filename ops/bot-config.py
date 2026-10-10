"""Configure and verify Bot API presentation after HTTPS health checks pass."""
import json
import pathlib
import sys
import urllib.parse
import urllib.request

COPY = {
    'ru': {
        'commands': [('start', 'Приветствие и запуск приложения'), ('help', 'Навигация и команды'), ('terms', 'Условия и GPU-тарифы'), ('support', 'Обратиться в поддержку'), ('paysupport', 'Вопрос по платежу')],
        'description': 'Добро пожаловать в AetherMind! 🖥\n\nУчастие в коммерческом DePIN-кластере GPU, договоры, баланс и партнёрская программа — в одном приложении.\n\nНачните с /start. Ознакомьтесь с публичной офертой в приложении и следуйте подсказкам в профиле.\n\n🎧 Помощь: /support',
        'short': '🖥 GPU DePIN • Договоры • Баланс • Партнёрская программа. Откройте AetherMind и начните с профиля.'
    },
    'en': {
        'commands': [('start', 'Welcome and launch the app'), ('help', 'Navigation and commands'), ('terms', 'Terms and GPU plans'), ('support', 'Contact support'), ('paysupport', 'Payment support')],
        'description': 'Welcome to AetherMind! 🖥\n\nJoin the commercial DePIN GPU cluster. Contracts, balance and the partner program — in one app.\n\nStart with /start. Read the public offer in the app and follow your profile’s next steps.\n\n🎧 Help: /support',
        'short': '🖥 GPU DePIN • Contracts • Balance • Partner program. Open AetherMind and start with your profile.'
    },
    'ro': {
        'commands': [('start', 'Bun venit și lansare aplicație'), ('help', 'Navigare și comenzi'), ('terms', 'Condiții și planuri GPU'), ('support', 'Contactează asistența'), ('paysupport', 'Asistență pentru plăți')],
        'description': 'Bun venit în AetherMind! 🖥\n\nParticipă la clusterul GPU DePIN comercial. Contracte, sold și program de parteneriat — într-o aplicație.\n\nÎncepe cu /start. Citește oferta publică în aplicație și urmează indicațiile din profil.\n\n🎧 Ajutor: /support',
        'short': '🖥 GPU DePIN • Contracte • Sold • Parteneriat. Deschide AetherMind și începe cu profilul tău.'
    }
}


def configure(env, call):
    url = env['PUBLIC_URL'].rstrip('/')
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path:
        raise ValueError('Проверьте PUBLIC_URL: нужен корневой HTTPS-адрес приложения.')
    bot = call('getMe', {})
    if bot.get('username') != env['BOT_USERNAME']:
        raise ValueError('Имя бота не совпадает с настройками.')
    hook_url = url + '/api/telegram/webhook'
    current = call('getWebhookInfo', {})
    if current.get('url') and current['url'] != hook_url:
        raise ValueError('У бота уже настроен другой webhook. Он не изменён.')
    call('setWebhook', {'url': hook_url, 'secret_token': env['BOT_WEBHOOK_SECRET'], 'allowed_updates': ['message', 'callback_query'], 'drop_pending_updates': False})
    call('setChatMenuButton', {'menu_button': {'type': 'web_app', 'text': 'Открыть', 'web_app': {'url': url + '/'}}})
    for language in ('', 'ru', 'en', 'ro'):
        copy = COPY[language or 'ru']
        locale = {'language_code': language} if language else {}
        commands = [{'command': name, 'description': description} for name, description in copy['commands']]
        call('setMyCommands', {**locale, 'commands': commands})
        call('setMyDescription', {**locale, 'description': copy['description']})
        call('setMyShortDescription', {**locale, 'short_description': copy['short']})
        if [{'command': item.get('command'), 'description': item.get('description')} for item in call('getMyCommands', locale)] != commands:
            raise ValueError('Не удалось проверить команды бота: ' + (language or 'default'))
        if call('getMyDescription', locale).get('description') != copy['description']:
            raise ValueError('Не удалось проверить описание бота.')
        if call('getMyShortDescription', locale).get('short_description') != copy['short']:
            raise ValueError('Не удалось проверить краткое описание бота.')
    button, hook = call('getChatMenuButton', {}), call('getWebhookInfo', {})
    if hook.get('url') != hook_url or not {'message', 'callback_query'}.issubset(hook.get('allowed_updates', [])):
        raise ValueError('Не удалось проверить команды и подтверждение входа через бота.')
    if button.get('type') != 'web_app' or button.get('web_app', {}).get('url') != url + '/' or button.get('text') != 'Открыть':
        raise ValueError('Не удалось проверить кнопку меню.')
    return bot, url


def main():
    env = dict(line.split('=', 1) for line in pathlib.Path('/srv/apps/gpunode/shared/runtime.env').read_text().splitlines() if line and not line.startswith('#'))
    def call(method, data):
        try:
            request = urllib.request.Request('https://api.telegram.org/bot' + env['BOT_TOKEN'] + '/' + method, data=json.dumps(data).encode(), headers={'Content-Type': 'application/json'})
            with urllib.request.urlopen(request, timeout=25) as response:
                result = json.load(response)
            if not result.get('ok'):
                raise ValueError()
            return result['result']
        except Exception:
            raise ValueError('Сайт работает, настройка бота не завершена. Повторите: sudo python3 /srv/apps/gpunode/current/ops/bot-config.py') from None
    try:
        if sys.argv[1:] == ['--check-main-app']:
            bot, url = call('getMe', {}), env['PUBLIC_URL'].rstrip('/')
            if bot.get('username') != env['BOT_USERNAME']:
                raise ValueError('Имя бота не совпадает с настройками.')
        elif not sys.argv[1:]:
            bot, url = configure(env, call)
            print('Бот @' + bot['username'] + ': команды RU/EN/RO, описания, кнопка меню и webhook проверены.')
        else:
            raise ValueError('Использование: bot-config.py [--check-main-app]')
    except (ValueError, KeyError) as error:
        raise SystemExit(str(error)) from None
    if bot.get('has_main_web_app'):
        print('Главное Mini App включено: https://t.me/' + bot['username'] + '?startapp')
        print('Расположение нативной кнопки «Открыть» определяет клиент Telegram.')
    else:
        print('ОСТАЛОСЬ В BOTFATHER: /mybots → @' + bot['username'] + ' → Bot Settings → Configure Mini App → Enable Mini App')
        print('Адрес главного приложения: ' + url + '/')
        print('Главное Mini App нельзя включить методом Bot API. После включения проверьте: sudo python3 /srv/apps/gpunode/current/ops/bot-config.py --check-main-app')


if __name__ == '__main__':
    main()
