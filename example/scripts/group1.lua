-- groups don't run init() apparently?
function update()
    local tags = self:findAllByProperty('tag', 'example')
    tags[#tags].color = Color.fromHexString(GROUP_LAST_TAG_COLOR)
end
