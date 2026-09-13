"""Configure Bot API only after HTTPS health checks have passed."""
import json, pathlib, sys, urllib.request
env=dict(line.split('=',1) for line in pathlib.Path('/srv/apps/gpunode/shared/runtime.env').read_text().splitlines() if line and not line.startswith('#'))
def call(method,data):
    try:
        req=urllib.request.Request('https://api.telegram.org/bot'+env['BOT_TOKEN']+'/'+method,data=json.dumps(data).encode(),headers={'Content-Type':'application/json'})
        with urllib.request.urlopen(req,timeout=25) as response: result=json.load(response)
        if not result.get('ok'): raise ValueError()
        return result['result']
    except Exception:
        raise SystemExit('Сайт работает, настройка бота не завершена. Повторите: sudo python3 /srv/apps/gpunode/current/ops/bot-config.py') from None
bot=call('getMe',{})
if bot['username']!=env['BOT_USERNAME']:raise SystemExit('Имя бота не совпадает с настройками.')
current=call('getWebhookInfo',{})
target=env['PUBLIC_URL']+'/api/telegram/webhook'
if current.get('url') and current['url']!=target:
    raise SystemExit('У бота уже настроен другой webhook. Он не изменён. Отключите прежний обработчик и согласуйте замену.')
call('setWebhook',{'url':target,'secret_token':env['BOT_WEBHOOK_SECRET'],'allowed_updates':['message'],'drop_pending_updates':False})
call('setChatMenuButton',{'menu_button':{'type':'web_app','text':'Открыть AetherMind','web_app':{'url':env['PUBLIC_URL']+'/'}}})
call('setMyCommands',{'commands':[{'command':'start','description':'Открыть AetherMind'},{'command':'support','description':'Поддержка'},{'command':'terms','description':'Условия работы'}]})
button=call('getChatMenuButton',{})
if button.get('web_app',{}).get('url')!=env['PUBLIC_URL']+'/':raise SystemExit('Не удалось проверить кнопку меню.')
print('Бот @'+bot['username']+': кнопка меню, /start и webhook настроены.')
